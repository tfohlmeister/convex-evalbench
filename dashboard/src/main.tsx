import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { ConvexProvider } from "convex/react";
import { BrowserRouter } from "react-router-dom";
import { App } from "./App";
import { convex } from "./lib/convex";
import "./styles.css";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <ConvexProvider client={convex}>
      <BrowserRouter>
        <App />
      </BrowserRouter>
    </ConvexProvider>
  </StrictMode>,
);
