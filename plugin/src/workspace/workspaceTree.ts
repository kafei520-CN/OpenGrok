export interface WorkspaceTreeNode {
  name: string;
  rel: string;
  path?: string;
  children?: WorkspaceTreeNode[];
}

export function buildWorkspaceTree(files: Array<{ path: string; rel: string }>): WorkspaceTreeNode[] {
  const root: WorkspaceTreeNode[] = [];
  const dirs = new Map<string, WorkspaceTreeNode[]>();
  dirs.set('', root);
  const ensureDir = (rel: string): WorkspaceTreeNode[] => {
    const hit = dirs.get(rel);
    if (hit) {
      return hit;
    }
    const parts = rel.split('/').filter(Boolean);
    const name = parts.at(-1) ?? rel;
    const parentRel = parts.slice(0, -1).join('/');
    const parent = parentRel ? ensureDir(parentRel) : root;
    const children: WorkspaceTreeNode[] = [];
    parent.push({ name, rel, children });
    dirs.set(rel, children);
    return children;
  };
  for (const file of files) {
    const rel = file.rel.replace(/\\/g, '/');
    const parts = rel.split('/').filter(Boolean);
    const name = parts.pop() ?? rel;
    const dirRel = parts.join('/');
    const bucket = dirRel ? ensureDir(dirRel) : root;
    bucket.push({ name, rel, path: file.path });
  }
  sortTree(root);
  return root;
}

function sortTree(nodes: WorkspaceTreeNode[]): void {
  nodes.sort((a, b) => {
    const dirA = a.children ? 0 : 1;
    const dirB = b.children ? 0 : 1;
    if (dirA !== dirB) {
      return dirA - dirB;
    }
    return a.name.localeCompare(b.name);
  });
  for (const node of nodes) {
    if (node.children) {
      sortTree(node.children);
    }
  }
}
