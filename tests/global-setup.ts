import { buildFixtures } from "./fixtures";

export default async function globalSetup() {
  await buildFixtures();
}
