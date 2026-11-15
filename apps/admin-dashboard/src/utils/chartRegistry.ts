import {
  Chart,
  BarController,
  LineController,
  CategoryScale,
  LinearScale,
  BarElement,
  PointElement,
  LineElement,
  Title,
  Tooltip,
  Legend,
  Filler,
} from "chart.js";

// Tree-shaken chart.js has no built-in types: `new Chart({ type: "bar" })`
// throws '"bar" is not a registered controller' unless the controller is
// registered. Every component that constructs a Chart directly imports this.
Chart.register(
  BarController,
  LineController,
  CategoryScale,
  LinearScale,
  BarElement,
  PointElement,
  LineElement,
  Title,
  Tooltip,
  Legend,
  Filler,
);
