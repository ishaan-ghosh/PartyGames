import { MuteToggle } from "@party/ui";
import { Route, Switch } from "wouter";
import { Fatal } from "./pages/Fatal";
import { Home } from "./pages/Home";
import { RoomPage } from "./pages/RoomPage";

export function App() {
  return (
    <>
      <Switch>
        <Route path="/" component={Home} />
        <Route path="/room/:code">{(params) => <RoomPage key={params.code} code={params.code} />}</Route>
        <Route>
          <Fatal message="Page not found." />
        </Route>
      </Switch>
      <MuteToggle floating />
    </>
  );
}
