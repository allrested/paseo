import { join } from "node:path";

export interface DesignPaths {
  filesJson: string;
  scratchRoot: string;
  runDir: string;
}

export function designPaths(env: NodeJS.ProcessEnv, home: string): DesignPaths {
  const root = join(env.PASEO_HOME?.trim() || join(home, ".paseo"), "design");
  return {
    filesJson: join(root, "files.json"),
    scratchRoot: join(root, "scratch"),
    runDir: join(root, "run"),
  };
}

/** FigCraft's write root for one project. Slashes become underscores so a key is one folder. */
export function scratchDir(paths: DesignPaths, projectKey: string): string {
  return join(paths.scratchRoot, projectKey.replace(/[/\\]/g, "_"));
}
