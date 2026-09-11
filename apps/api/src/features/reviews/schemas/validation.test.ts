import { describe, it, expect } from "vitest";
import {
  REVIEW_CONTENT_MAX_LENGTH,
  publicReviewListQuerySchema,
  replyToReviewSchema,
  reviewListQuerySchema,
  submitOrderReviewSchema,
} from "./validation";

describe("submitOrderReviewSchema", () => {
  it("accepts this feature's shape", () => {
    expect(
      submitOrderReviewSchema.parse({
        rating: 4,
        content: "上菜很快",
        items: [{ menuItemId: 7, rating: 5 }],
      }),
    ).toMatchObject({
      rating: 4,
      content: "上菜很快",
      items: [{ menuItemId: 7, rating: 5 }],
    });
  });

  it("accepts the body the customer app already sends", () => {
    // orderApi.submitOrderReview has posted this shape since before any route
    // answered it. Breaking it would break the app that is already shipping.
    expect(
      submitOrderReviewSchema.parse({
        rating: 5,
        comment: "很好吃",
        itemRatings: [{ orderItemId: 12, rating: 4, comment: "還行" }],
      }),
    ).toMatchObject({
      rating: 5,
      comment: "很好吃",
      itemRatings: [{ orderItemId: 12, rating: 4 }],
    });
  });

  it("requires a rating, and only 1-5", () => {
    expect(() => submitOrderReviewSchema.parse({})).toThrow();
    expect(() => submitOrderReviewSchema.parse({ rating: 0 })).toThrow();
    expect(() => submitOrderReviewSchema.parse({ rating: 6 })).toThrow();
    expect(() => submitOrderReviewSchema.parse({ rating: 3.5 })).toThrow();
    expect(submitOrderReviewSchema.parse({ rating: 1 }).rating).toBe(1);
    expect(submitOrderReviewSchema.parse({ rating: 5 }).rating).toBe(5);
  });

  it("treats whitespace-only content as no content", () => {
    expect(
      submitOrderReviewSchema.parse({ rating: 5, content: "   " }).content,
    ).toBeNull();
  });

  it("rejects content past the ceiling on both field names", () => {
    const tooLong = "字".repeat(REVIEW_CONTENT_MAX_LENGTH + 1);
    expect(() =>
      submitOrderReviewSchema.parse({ rating: 5, content: tooLong }),
    ).toThrow();
    expect(() =>
      submitOrderReviewSchema.parse({ rating: 5, comment: tooLong }),
    ).toThrow();
  });

  it("rejects an item rating outside 1-5 and a non-positive item id", () => {
    expect(() =>
      submitOrderReviewSchema.parse({
        rating: 5,
        items: [{ menuItemId: 7, rating: 9 }],
      }),
    ).toThrow();
    expect(() =>
      submitOrderReviewSchema.parse({
        rating: 5,
        items: [{ menuItemId: 0, rating: 5 }],
      }),
    ).toThrow();
  });
});

describe("replyToReviewSchema", () => {
  it("requires non-empty content within the ceiling", () => {
    expect(replyToReviewSchema.parse({ content: " 謝謝 " }).content).toBe(
      "謝謝",
    );
    expect(() => replyToReviewSchema.parse({ content: "   " })).toThrow();
    expect(() =>
      replyToReviewSchema.parse({
        content: "字".repeat(REVIEW_CONTENT_MAX_LENGTH + 1),
      }),
    ).toThrow();
  });
});

describe("reviewListQuerySchema", () => {
  it("defaults pagination and leaves the filters absent", () => {
    expect(reviewListQuerySchema.parse({})).toEqual({
      page: 1,
      limit: 20,
      rating: undefined,
      replied: undefined,
      from: undefined,
      to: undefined,
    });
  });

  it("reads replied as a tri-state", () => {
    expect(reviewListQuerySchema.parse({ replied: "true" }).replied).toBe(true);
    expect(reviewListQuerySchema.parse({ replied: "1" }).replied).toBe(true);
    // A checkbox serialised by hand sends the bare key with no value.
    expect(reviewListQuerySchema.parse({ replied: "" }).replied).toBe(true);
    expect(reviewListQuerySchema.parse({ replied: "false" }).replied).toBe(
      false,
    );
    expect(reviewListQuerySchema.parse({ replied: "0" }).replied).toBe(false);
    expect(reviewListQuerySchema.parse({}).replied).toBeUndefined();
  });

  it("only accepts a rating filter of 1-5", () => {
    expect(reviewListQuerySchema.parse({ rating: "3" }).rating).toBe(3);
    expect(() => reviewListQuerySchema.parse({ rating: "6" })).toThrow();
    expect(() => reviewListQuerySchema.parse({ rating: "x" })).toThrow();
  });

  it("takes from/to as integer milliseconds", () => {
    expect(reviewListQuerySchema.parse({ from: "1700000000000" }).from).toBe(
      1700000000000,
    );
    // An ISO string is the likely mistake, and it must not silently become NaN.
    expect(() =>
      reviewListQuerySchema.parse({ from: "2026-01-01T00:00:00Z" }),
    ).toThrow();
  });

  it("bounds the page size", () => {
    expect(reviewListQuerySchema.parse({ limit: "100" }).limit).toBe(100);
    expect(() => reviewListQuerySchema.parse({ limit: "101" })).toThrow();
  });
});

describe("publicReviewListQuerySchema", () => {
  it("defaults to a smaller page and caps lower than the owner list", () => {
    expect(publicReviewListQuerySchema.parse({})).toEqual({
      page: 1,
      limit: 10,
    });
    expect(publicReviewListQuerySchema.parse({ limit: "50" }).limit).toBe(50);
    expect(() => publicReviewListQuerySchema.parse({ limit: "51" })).toThrow();
  });
});
