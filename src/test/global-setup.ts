import { buildTemplate, dropTemplate } from "./pg";

export default async function setup() {
  await buildTemplate();
  return dropTemplate;
}
