import { join } from "node:path";

export interface DesignPaths {
  filesJson: string;
  runDir: string;
}

export function designPaths(env: NodeJS.ProcessEnv, home: string): DesignPaths {
  const root = join(env.PASEO_HOME?.trim() || join(home, ".paseo"), "design");
  return {
    filesJson: join(root, "files.json"),
    runDir: join(root, "run"),
  };
}
