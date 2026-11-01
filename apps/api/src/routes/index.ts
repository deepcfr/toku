import Elysia from "elysia";
import { healthRoutes } from "./health";

// mount all http route groups
export const routes = new Elysia({ name: "routes" }).use(healthRoutes);
