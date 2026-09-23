/**
 * Database Performance Testing Utility
 *
 * Provides comprehensive tools for benchmarking D1 database queries:
 * - Query execution time measurement
 * - N+1 query detection
 * - Index efficiency validation
 * - Concurrent load testing
 * - Performance baseline management
 */

import { fileURLToPath } from "node:url";

interface QueryResult<T = unknown> {
  results: T[];
}

interface QueryStatement {
  bind(...values: unknown[]): QueryStatement;
  all<T = unknown>(): Promise<QueryResult<T>>;
}

interface QueryDatabase {
  prepare(query: string): QueryStatement;
}

export interface QueryPerformanceResult {
  query: string;
  executionTime: number; // milliseconds
  rowsReturned: number;
  timestamp: number;
  indexUsed: boolean;
  queryPlan?: string;
}

export interface N1DetectionResult {
  endpoint: string;
  totalQueries: number;
  uniqueQueries: number;
  repeatedQueries: Array<{
    query: string;
    count: number;
  }>;
  hasN1Problem: boolean;
  suggestions: string[];
}

export interface PerformanceBaseline {
  version: string;
  timestamp: number;
  queries: Record<
    string,
    {
      avgTime: number;
      p95Time: number;
      p99Time: number;
      indexUsed?: boolean;
    }
  >;
}

export class DatabasePerformanceTester {
  private db: QueryDatabase;
  private queryLog: QueryPerformanceResult[] = [];
  private enableQueryLogging: boolean = false;

  constructor(db: QueryDatabase) {
    this.db = db;
  }

  /**
   * Enable query logging for N+1 detection
   */
  startQueryLogging(): void {
    this.enableQueryLogging = true;
    this.queryLog = [];
  }

  /**
   * Stop query logging and analyze results
   */
  stopQueryLogging(): N1DetectionResult {
    this.enableQueryLogging = false;
    return this.analyzeN1Queries();
  }

  /**
   * Measure single query performance
   */
  async measureQuery(
    query: string,
    params: any[] = [],
    options: { warmup?: boolean; explain?: boolean } = {},
  ): Promise<QueryPerformanceResult> {
    // Warmup run (not measured)
    if (options.warmup) {
      await this.db
        .prepare(query)
        .bind(...params)
        .all();
    }

    // Get query plan if requested
    let queryPlan: string | undefined;
    if (options.explain) {
      const planResult = await this.db
        .prepare(`EXPLAIN QUERY PLAN ${query}`)
        .bind(...params)
        .all();
      queryPlan = JSON.stringify(planResult.results);
    }

    // Measure execution time
    const startTime = performance.now();
    const result = await this.db
      .prepare(query)
      .bind(...params)
      .all();
    const endTime = performance.now();

    const executionTime = endTime - startTime;
    const rowsReturned = result.results?.length || 0;

    // Check if index was used (from query plan).
    //
    // SQLite's `EXPLAIN QUERY PLAN` `detail` column reports several
    // index-using forms; we accept any of them as "indexed":
    //
    //   - SEARCH ... USING INDEX <name>          (regular indexed search)
    //   - SEARCH ... USING COVERING INDEX <name> (index alone satisfies SELECT)
    //   - SEARCH ... USING INTEGER PRIMARY KEY   (rowid lookup, also an index)
    //   - SEARCH ... USING PRIMARY KEY           (PK index lookup)
    //
    // The previous implementation only checked the literal substring
    // "USING INDEX" which (a) misses COVERING INDEX since "COVERING " sits
    // between USING and INDEX, and (b) misses PRIMARY KEY lookups entirely.
    const indexUsed =
      queryPlan !== undefined &&
      /USING (COVERING )?INDEX|USING (INTEGER )?PRIMARY KEY/.test(queryPlan);

    const perfResult: QueryPerformanceResult = {
      query,
      executionTime,
      rowsReturned,
      timestamp: Date.now(),
      indexUsed,
      queryPlan,
    };

    // Log if logging is enabled
    if (this.enableQueryLogging) {
      this.queryLog.push(perfResult);
    }

    return perfResult;
  }

  /**
   * Run query multiple times and get statistics
   */
  async benchmarkQuery(
    query: string,
    params: any[] = [],
    iterations: number = 10,
  ): Promise<{
    query: string;
    iterations: number;
    avgTime: number;
    minTime: number;
    maxTime: number;
    p95Time: number;
    p99Time: number;
    stdDev: number;
  }> {
    const times: number[] = [];

    // Warmup
    await this.measureQuery(query, params, { warmup: true });

    // Run benchmark
    for (let i = 0; i < iterations; i++) {
      const result = await this.measureQuery(query, params);
      times.push(result.executionTime);
    }

    // Calculate statistics
    times.sort((a, b) => a - b);
    const avgTime = times.reduce((a, b) => a + b, 0) / times.length;
    const minTime = times[0];
    const maxTime = times[times.length - 1];
    const p95Time = times[Math.floor(times.length * 0.95)];
    const p99Time = times[Math.floor(times.length * 0.99)];

    // Calculate standard deviation
    const variance =
      times.reduce((sum, time) => sum + Math.pow(time - avgTime, 2), 0) /
      times.length;
    const stdDev = Math.sqrt(variance);

    return {
      query,
      iterations,
      avgTime,
      minTime,
      maxTime,
      p95Time,
      p99Time,
      stdDev,
    };
  }

  /**
   * Test concurrent query execution
   */
  async benchmarkConcurrent(
    query: string,
    params: any[] = [],
    concurrency: number = 10,
  ): Promise<{
    concurrency: number;
    totalTime: number;
    avgQueryTime: number;
    successCount: number;
    errorCount: number;
  }> {
    const startTime = performance.now();
    const promises = [];

    for (let i = 0; i < concurrency; i++) {
      promises.push(
        this.measureQuery(query, params).catch((error) => ({
          error: true,
          message: error.message,
        })),
      );
    }

    const results = await Promise.all(promises);
    const endTime = performance.now();

    const successResults = results.filter(
      (r: any) => !r.error,
    ) as QueryPerformanceResult[];
    const errorCount = results.filter((r: any) => r.error).length;

    const avgQueryTime =
      successResults.length > 0
        ? successResults.reduce((sum, r) => sum + r.executionTime, 0) /
          successResults.length
        : 0;

    return {
      concurrency,
      totalTime: endTime - startTime,
      avgQueryTime,
      successCount: successResults.length,
      errorCount,
    };
  }

  /**
   * Analyze query log for N+1 problems
   */
  private analyzeN1Queries(): N1DetectionResult {
    const totalQueries = this.queryLog.length;
    const uniqueQueries = new Set(this.queryLog.map((q) => q.query)).size;

    // Count repeated queries
    const queryCounts = new Map<string, number>();
    this.queryLog.forEach((log) => {
      queryCounts.set(log.query, (queryCounts.get(log.query) || 0) + 1);
    });

    const repeatedQueries = Array.from(queryCounts.entries())
      .filter(([_, count]) => count > 1)
      .map(([query, count]) => ({ query, count }))
      .sort((a, b) => b.count - a.count);

    // Detect N+1 problem
    // Heuristic: If we have more than 5 identical queries, it's likely an N+1 problem
    const hasN1Problem = repeatedQueries.some((q) => q.count > 5);

    // Generate suggestions
    const suggestions: string[] = [];
    if (hasN1Problem) {
      suggestions.push("🔴 N+1 query problem detected!");
      suggestions.push(
        "Consider using JOIN or batch loading to reduce queries",
      );

      repeatedQueries.slice(0, 3).forEach((q) => {
        suggestions.push(
          `  - Query executed ${q.count} times: ${q.query.substring(0, 100)}...`,
        );
      });
    }

    if (totalQueries > 20) {
      suggestions.push(
        "⚠️ High number of queries per request. Consider caching or optimization.",
      );
    }

    return {
      endpoint: "unknown", // Will be set by caller
      totalQueries,
      uniqueQueries,
      repeatedQueries,
      hasN1Problem,
      suggestions,
    };
  }

  /**
   * Validate index usage for a query
   */
  async validateIndexUsage(
    query: string,
    params: any[] = [],
  ): Promise<{
    query: string;
    indexUsed: boolean;
    queryPlan: string;
    executionTime: number;
    recommendation: string;
  }> {
    const result = await this.measureQuery(query, params, { explain: true });

    let recommendation = "";
    if (!result.indexUsed) {
      recommendation =
        "⚠️ No index used. Consider adding an index for better performance.";
    } else {
      recommendation = "✅ Query uses index efficiently.";
    }

    return {
      query,
      indexUsed: result.indexUsed,
      queryPlan: result.queryPlan || "N/A",
      executionTime: result.executionTime,
      recommendation,
    };
  }

  /**
   * Test query performance under load
   */
  async stressTest(
    query: string,
    params: any[] = [],
    duration: number = 10000, // 10 seconds
  ): Promise<{
    duration: number;
    totalQueries: number;
    successfulQueries: number;
    failedQueries: number;
    avgTime: number;
    maxTime: number;
    queriesPerSecond: number;
  }> {
    const startTime = Date.now();
    const endTime = startTime + duration;
    let totalQueries = 0;
    let successfulQueries = 0;
    let failedQueries = 0;
    // Running totals, not a samples array: a fast machine completes a few
    // hundred thousand queries per window, and Math.max(...samples) at that
    // size throws "Maximum call stack size exceeded".
    let totalTime = 0;
    let maxTime = 0;

    while (Date.now() < endTime) {
      try {
        const result = await this.measureQuery(query, params);
        totalTime += result.executionTime;
        maxTime = Math.max(maxTime, result.executionTime);
        successfulQueries++;
      } catch (error) {
        failedQueries++;
      }
      totalQueries++;
    }

    const actualDuration = Date.now() - startTime;
    const avgTime = successfulQueries > 0 ? totalTime / successfulQueries : 0;
    const queriesPerSecond = (totalQueries / actualDuration) * 1000;

    return {
      duration: actualDuration,
      totalQueries,
      successfulQueries,
      failedQueries,
      avgTime,
      maxTime,
      queriesPerSecond,
    };
  }

  /**
   * Clear query log
   */
  clearQueryLog(): void {
    this.queryLog = [];
  }

  /**
   * Get query log
   */
  getQueryLog(): QueryPerformanceResult[] {
    return [...this.queryLog];
  }
}

/**
 * Performance baseline manager
 */
export class PerformanceBaselineManager {
  private baselinePath: string;

  constructor(
    baselinePath: string = fileURLToPath(
      new URL("../baselines/db-baseline.json", import.meta.url),
    ),
  ) {
    this.baselinePath = baselinePath;
  }

  /**
   * Load baseline from file
   */
  async loadBaseline(): Promise<PerformanceBaseline | null> {
    try {
      const fs = await import("fs/promises");
      const data = await fs.readFile(this.baselinePath, "utf-8");
      return JSON.parse(data);
    } catch (error) {
      return null;
    }
  }

  /**
   * Save baseline to file
   */
  async saveBaseline(baseline: PerformanceBaseline): Promise<void> {
    const fs = await import("fs/promises");
    const path = await import("path");

    // Ensure directory exists
    const dir = path.dirname(this.baselinePath);
    await fs.mkdir(dir, { recursive: true });

    // Save baseline
    await fs.writeFile(
      this.baselinePath,
      JSON.stringify(baseline, null, 2),
      "utf-8",
    );
  }

  /**
   * Compare current performance with baseline
   */
  compareWithBaseline(
    current: Record<string, { avgTime: number; p95Time: number }>,
    baseline: PerformanceBaseline,
  ): {
    queryName: string;
    currentAvg: number;
    baselineAvg: number;
    percentageChange: number;
    status: "improved" | "degraded" | "stable";
  }[] {
    const results = [];

    for (const [queryName, currentMetrics] of Object.entries(current)) {
      const baselineMetrics = baseline.queries[queryName];
      if (!baselineMetrics) continue;

      // Sub-millisecond SQLite timings are noisy across CI hosts. Keep the
      // stored baseline precise for reporting, but use a 1ms comparison floor
      // so a 0.10ms -> 0.20ms scheduler blip is not treated as a 100% failure.
      const comparisonBaseline = Math.max(baselineMetrics.avgTime, 1);
      const percentageChange =
        baselineMetrics.avgTime < 1 && currentMetrics.avgTime < 1
          ? 0
          : ((currentMetrics.avgTime - comparisonBaseline) /
              comparisonBaseline) *
            100;

      let status: "improved" | "degraded" | "stable";
      if (percentageChange > 20) {
        status = "degraded";
      } else if (percentageChange < -20) {
        status = "improved";
      } else {
        status = "stable";
      }

      results.push({
        queryName,
        currentAvg: currentMetrics.avgTime,
        baselineAvg: baselineMetrics.avgTime,
        percentageChange,
        status,
      });
    }

    return results;
  }

  /**
   * Create baseline from benchmark results
   */
  createBaseline(
    version: string,
    benchmarkResults: Record<
      string,
      {
        avgTime: number;
        p95Time: number;
        p99Time: number;
        indexUsed?: boolean;
      }
    >,
  ): PerformanceBaseline {
    return {
      version,
      timestamp: Date.now(),
      queries: benchmarkResults,
    };
  }
}
