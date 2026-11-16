import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

import "./styles.css";

const container = document.getElementById("root");

if (container) {
  createRoot(container).render(<StrictMode><p>live.versatile.sh</p></StrictMode>);
}
