import { Route, Router } from "@solidjs/router";
import { lazy } from "solid-js";
import { render } from "solid-js/web";
import { App } from "./App";
import "./index.css";

const Home = lazy(() => import("~/routes/index"));
const Editor = lazy(() => import("~/routes/editor/index"));
const Callback = lazy(() => import("~/routes/callback"));

const root = document.getElementById("root");

if (!root) {
  throw new Error("Root element not found");
}

render(
  () => (
    <Router root={App}>
      <Route path="/" component={Home} />
      <Route path="/editor" component={Editor} />
      <Route path="/editor/:rkey" component={Editor} />
      <Route path="/editor/:handle/:rkey" component={Editor} />
      <Route path="/callback" component={Callback} />
    </Router>
  ),
  root,
);
