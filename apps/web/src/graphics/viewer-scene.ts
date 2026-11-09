import { LIMIT } from '@voxel/shared';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import type { ViewerConnection } from '../network/viewer-connection';
import { buildBlockMeshes, disposeBlockMeshes } from './block-meshes';
import { VoxelAvatar } from './entities/avatar';

/**
 * Spectator scene: orbit camera over the whole world, blocks and players from
 * the read-only viewer feed. No keyboard movement, pointer lock or block editing.
 */
export class ViewerScene {
  renderer: THREE.WebGLRenderer;
  scene = new THREE.Scene();
  camera = new THREE.PerspectiveCamera(55, 1, 0.1, Math.max(300, LIMIT * 12));
  private controls: OrbitControls;
  private meshes: THREE.InstancedMesh[] = [];
  private avatars = new Map<string, VoxelAvatar>();
  private raf = 0;
  private last = 0;
  private keys = new Set<string>();

  constructor(
    private host: HTMLDivElement,
    private feed: ViewerConnection,
  ) {
    this.renderer = new THREE.WebGLRenderer({ antialias: true });
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.domElement.setAttribute('aria-label', 'Live world view');
    host.appendChild(this.renderer.domElement);
    this.scene.background = new THREE.Color(0xc6e2e7);
    this.scene.fog = new THREE.Fog(0xc6e2e7, LIMIT * 4, LIMIT * 9);
    this.scene.add(new THREE.HemisphereLight(0xdff7ff, 0x536339, 2.5));
    const sun = new THREE.DirectionalLight(0xffecc6, 3);
    sun.position.set(LIMIT * 0.8, LIMIT * 1.2, LIMIT * 0.5);
    this.scene.add(sun);
    const seaSize = Math.max(150, LIMIT * 16);
    const sea = new THREE.Mesh(
      new THREE.PlaneGeometry(seaSize, seaSize),
      new THREE.MeshStandardMaterial({ color: 0x7aaeb6, roughness: 0.5 }),
    );
    sea.rotation.x = -Math.PI / 2;
    sea.position.y = -0.55;
    this.scene.add(sea);
    // Start framed on the whole world, looking down at an angle.
    this.camera.position.set(LIMIT * 1.4, LIMIT * 1.3, LIMIT * 1.4);
    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.target.set(0, 2, 0);
    this.controls.enableDamping = true;
    this.controls.enablePan = true;
    this.controls.screenSpacePanning = false; // right-drag pans along the ground
    this.controls.maxPolarAngle = Math.PI * 0.48;
    this.controls.minDistance = 4;
    this.controls.maxDistance = LIMIT * 5;
    this.controls.update();
    this.resize();
    window.addEventListener('resize', this.resize);
    window.addEventListener('keydown', this.keydown);
    window.addEventListener('keyup', this.keyup);
    window.addEventListener('blur', this.clearKeys);
    this.rebuild();
    this.raf = requestAnimationFrame(this.frame);
  }

  rebuild = () => {
    disposeBlockMeshes(this.scene, this.meshes);
    this.meshes = buildBlockMeshes(this.feed.blocks.values());
    for (const mesh of this.meshes) this.scene.add(mesh);
  };

  private resize = () => {
    const w = this.host.clientWidth,
      h = this.host.clientHeight;
    this.renderer.setSize(w, h);
    this.camera.aspect = w / Math.max(1, h);
    this.camera.updateProjectionMatrix();
  };

  private static MOVE_KEYS = new Set([
    'KeyW',
    'KeyA',
    'KeyS',
    'KeyD',
    'KeyQ',
    'KeyE',
    'ArrowUp',
    'ArrowDown',
    'ArrowLeft',
    'ArrowRight',
    'ShiftLeft',
    'ShiftRight',
  ]);
  private keydown = (event: KeyboardEvent) => {
    if (!ViewerScene.MOVE_KEYS.has(event.code)) return;
    event.preventDefault();
    this.keys.add(event.code);
  };
  private keyup = (event: KeyboardEvent) => {
    this.keys.delete(event.code);
  };
  private clearKeys = () => this.keys.clear();

  /** Fly the camera and its orbit target together, relative to the view direction. */
  private move(dt: number) {
    const k = this.keys;
    const forward =
      Number(k.has('KeyW') || k.has('ArrowUp')) -
      Number(k.has('KeyS') || k.has('ArrowDown'));
    const strafe =
      Number(k.has('KeyD') || k.has('ArrowRight')) -
      Number(k.has('KeyA') || k.has('ArrowLeft'));
    const lift = Number(k.has('KeyE')) - Number(k.has('KeyQ'));
    if (!forward && !strafe && !lift) return;
    const speed = (k.has('ShiftLeft') || k.has('ShiftRight') ? 40 : 15) * dt;
    const ahead = new THREE.Vector3()
      .subVectors(this.controls.target, this.camera.position)
      .setY(0);
    if (ahead.lengthSq() < 1e-6) ahead.set(0, 0, -1);
    ahead.normalize();
    const right = new THREE.Vector3().crossVectors(ahead, this.camera.up);
    const step = new THREE.Vector3()
      .addScaledVector(ahead, forward * speed)
      .addScaledVector(right, strafe * speed);
    step.y = lift * speed;
    const bound = LIMIT * 1.5;
    const next = this.controls.target.clone().add(step);
    next.x = THREE.MathUtils.clamp(next.x, -bound, bound);
    next.z = THREE.MathUtils.clamp(next.z, -bound, bound);
    next.y = THREE.MathUtils.clamp(next.y, 0, LIMIT * 2);
    const applied = next.sub(this.controls.target);
    this.controls.target.add(applied);
    this.camera.position.add(applied);
  }

  private frame = (now: number) => {
    const dt = this.last ? Math.min((now - this.last) / 1000, 0.1) : 0;
    this.last = now;
    this.move(dt);
    const ids = new Set(this.feed.players.map((p) => p.id));
    for (const [id, avatar] of this.avatars)
      if (!ids.has(id)) {
        this.scene.remove(avatar);
        avatar.dispose();
        this.avatars.delete(id);
      }
    for (const p of this.feed.players) {
      let avatar = this.avatars.get(p.id);
      if (!avatar) {
        avatar = new VoxelAvatar(p);
        avatar.position.set(p.x, p.y, p.z);
        this.avatars.set(p.id, avatar);
        this.scene.add(avatar);
      }
      const px = avatar.position.x,
        pz = avatar.position.z;
      avatar.position.lerp(
        new THREE.Vector3(p.x, p.y, p.z),
        1 - Math.exp(-6 * dt),
      );
      avatar.rotation.y = p.yaw;
      avatar.animate(
        dt,
        dt > 0
          ? Math.hypot(avatar.position.x - px, avatar.position.z - pz) / dt
          : 0,
      );
      avatar.nameplate.update(
        p,
        this.camera.position.distanceTo(avatar.position),
      );
    }
    this.controls.update();
    this.renderer.render(this.scene, this.camera);
    this.raf = requestAnimationFrame(this.frame);
  };

  dispose() {
    cancelAnimationFrame(this.raf);
    window.removeEventListener('resize', this.resize);
    window.removeEventListener('keydown', this.keydown);
    window.removeEventListener('keyup', this.keyup);
    window.removeEventListener('blur', this.clearKeys);
    this.controls.dispose();
    disposeBlockMeshes(this.scene, this.meshes);
    for (const avatar of this.avatars.values()) avatar.dispose();
    this.renderer.dispose();
    this.renderer.domElement.remove();
  }
}
