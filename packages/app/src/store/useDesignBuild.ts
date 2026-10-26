import { designBuild, type ResolvedBuild } from '../lib/designBuild';
import { useBoard } from './useBoard';
import { useDesignStore } from './useDesignStore';
import { usePackages } from './usePackages';

/**
 * The build of the design on show (lib/designBuild.ts): its own board and package models, or
 * this browser's defaults while it has none. The same object while neither changes, so it can
 * be a memo dependency.
 */
export function useDesignBuild(): ResolvedBuild {
  const build = useDesignStore((s) => s.design.build);
  const board = useBoard((s) => s.board);
  const table = usePackages((s) => s.table);
  // The defaults are read through the stores above, so a change there renders again.
  void board;
  void table;
  return designBuild(build ? { build } : {});
}
