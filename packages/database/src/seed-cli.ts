import { getDatabasePath, seedDemoData } from "./index.js";

seedDemoData(true);
console.log(`Demo database seeded: ${getDatabasePath()}`);
