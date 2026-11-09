import type { Block, Material } from '@voxel/shared';
import * as THREE from 'three';

export const BLOCK_COLORS: Record<Material, number> = {
  grass: 0x6b9c52,
  dirt: 0x9c7353,
  stone: 0x8c999b,
  wood: 0xc19766,
};

/** One instanced mesh per material; `userData.blocks` maps instance ids back to blocks. */
export function buildBlockMeshes(
  blocks: Iterable<Block>,
): THREE.InstancedMesh[] {
  const all = [...blocks];
  return (Object.keys(BLOCK_COLORS) as Material[]).map((material) => {
    const list = all.filter((b) => b.material === material);
    const mesh = new THREE.InstancedMesh(
      new THREE.BoxGeometry(1, 1, 1),
      new THREE.MeshStandardMaterial({
        color: BLOCK_COLORS[material],
        roughness: 1,
      }),
      list.length,
    );
    const matrix = new THREE.Matrix4();
    list.forEach((b, i) => {
      matrix.makeTranslation(b.x, b.y, b.z);
      mesh.setMatrixAt(i, matrix);
    });
    mesh.userData.blocks = list;
    mesh.computeBoundingSphere();
    return mesh;
  });
}

export function disposeBlockMeshes(
  scene: THREE.Scene,
  meshes: THREE.InstancedMesh[],
) {
  for (const mesh of meshes) {
    scene.remove(mesh);
    mesh.geometry.dispose();
    (mesh.material as THREE.Material).dispose();
  }
}
