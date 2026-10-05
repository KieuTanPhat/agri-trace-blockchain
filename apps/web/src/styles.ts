// A single import graph preserves CSS order in root and route chunks.
import "./app/globals.css";
import dashboardStyles from "./features/dashboard/styles/dashboard.module.css";
import lotsStyles from "./features/lots/styles/lots.module.css";
import scanStyles from "./features/trace/styles/scan.module.css";
import traceStyles from "./features/trace/styles/trace.module.css";
import iotStyles from "./features/iot/styles/iot.module.css";
import "./shared/styles/motion.css";
import "./shared/styles/responsive.css";
import authStyles from "./features/auth/styles/auth.module.css";

export {
  dashboardStyles,
  lotsStyles,
  scanStyles,
  traceStyles,
  iotStyles,
  authStyles,
};
