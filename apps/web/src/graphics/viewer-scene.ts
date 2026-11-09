import { LIMIT, type Player } from '@voxel/shared';
import * as THREE from 'three';
import type { ViewerConnection } from '../network/viewer-connection';
import { buildBlockMeshes, disposeBlockMeshes } from './block-meshes';
import { VoxelAvatar } from './entities/avatar';

export type SpectatorMode =
  | { kind: 'free'; speed: number }
  | { kind: 'follow'; name: string }
  | { kind: 'overview' };

const LOOK_SENSITIVITY = 0.002; // same as the game's first-person camera
const SPEEDS = [1, 2, 3, 5, 8, 12, 20]; // blocks per second
const DEFAULT_SPEED = 3; // index into SPEEDS → 5 blocks/s
const EYE = 1.6;
const FOLLOW_BACK = 4;
const FOLLOW_UP = 2.2;
const MOVE_KEYS = new Set([
  'KeyW',
  'KeyA',
  'KeyS',
  'KeyD',
  'ArrowUp',
  'ArrowDown',
  'ArrowLeft',
  'ArrowRight',
  'Space',
  'ShiftLeft',
  'ShiftRight',
]);

/**
 * First-person spectator camera (Floperati), in the style of a game spectator
 * mode: free flight with mouse-look, follow a player, or an overview. Read-only:
 * it renders the viewer feed and never sends anything to the world.
 */
export class ViewerScene {
  renderer: THREE.WebGLRenderer;
  scene = new THREE.Scene();
  camera = new THREE.PerspectiveCamera(
    70,
    1,
    0.1,
    Math.max(150, Math.round(LIMIT * 10)),
  );
  onModeChange = (_mode: SpectatorMode) => {};
  private meshes: THREE.InstancedMesh[] = [];
  private avatars = new Map<string, VoxelAvatar>();
  private keys = new Set<string>();
  private yaw = 0;
  private pitch = -0.2;
  private speedIndex = DEFAULT_SPEED;
  private follow?: string; // player id
  private overview?: { position: THREE.Vector3; yaw: number; pitch: number };
  private placed = false;
  private dragging = false;
  private raf = 0;
  private last = 0;

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
    this.scene.fog = new THREE.Fog(
      0xc6e2e7,
      Math.round(LIMIT * 2),
      Math.round(LIMIT * 5),
    );
    this.scene.add(new THREE.HemisphereLight(0xdff7ff, 0x536339, 2.5));
    const sun = new THREE.DirectionalLight(0xffecc6, 3);
    sun.position.set(LIMIT * 0.8, LIMIT * 1.2, LIMIT * 0.5);
    this.scene.add(sun);
    const seaSize = Math.max(150, Math.round(LIMIT * 16));
    const sea = new THREE.Mesh(
      new THREE.PlaneGeometry(seaSize, seaSize),
      new THREE.MeshStandardMaterial({ color: 0x7aaeb6, roughness: 0.5 }),
    );
    sea.rotation.x = -Math.PI / 2;
    sea.position.y = -0.55;
    this.scene.add(sea);
    // Until a player appears, stand at the spawn area at eye level.
    this.camera.position.set(0, 2 + EYE, 8);
    this.applyLook();
    this.resize();
    window.addEventListener('resize', this.resize);
    window.addEventListener('keydown', this.keydown);
    window.addEventListener('keyup', this.keyup);
    window.addEventListener('blur', this.clearKeys);
    document.addEventListener('mousemove', this.mousemove);
    document.addEventListener('mouseup', this.mouseup);
    this.renderer.domElement.addEventListener('mousedown', this.mousedown);
    this.renderer.domElement.addEventListener('wheel', this.wheel, {
      passive: false,
    });
    this.renderer.domElement.addEventListener('contextmenu', this.noMenu);
    this.rebuild();
    this.raf = requestAnimationFrame(this.frame);
  }

  get mode(): SpectatorMode {
    if (this.overview) return { kind: 'overview' };
    const followed = this.feed.players.find((p) => p.id === this.follow);
    if (followed) return { kind: 'follow', name: followed.name };
    return { kind: 'free', speed: SPEEDS[this.speedIndex] };
  }

  rebuild = () => {
    disposeBlockMeshes(this.scene, this.meshes);
    this.meshes = buildBlockMeshes(this.feed.blocks.values());
    for (const mesh of this.meshes) this.scene.add(mesh);
  };

  private announce() {
    this.onModeChange(this.mode);
  }

  private applyLook() {
    this.camera.rotation.set(this.pitch, this.yaw, 0, 'YXZ');
  }

  /** First time players are known: stand behind the first one, at eye level. */
  private placeNear(player: Player) {
    this.yaw = player.yaw;
    this.pitch = -0.15;
    this.camera.position.set(
      player.x + Math.sin(this.yaw) * FOLLOW_BACK,
      player.y + EYE + 0.6,
      player.z + Math.cos(this.yaw) * FOLLOW_BACK,
    );
    this.applyLook();
    this.placed = true;
  }

  private toFree() {
    if (this.follow === undefined && !this.overview) return;
    this.follow = undefined;
    this.overview = undefined;
    this.announce();
  }

  private cycleFollow(step: number) {
    const players = this.feed.players;
    if (!players.length) return;
    this.overview = undefined;
    const index = players.findIndex((p) => p.id === this.follow);
    const next =
      index < 0
        ? step > 0
          ? 0
          : players.length - 1
        : (index + step + players.length) % players.length;
    this.follow = players[next].id;
    this.announce();
  }

  private toggleOverview() {
    if (this.overview) {
      // Return to where the spectator was before the overview.
      this.camera.position.copy(this.overview.position);
      this.yaw = this.overview.yaw;
      this.pitch = this.overview.pitch;
      this.overview = undefined;
    } else {
      this.follow = undefined;
      this.overview = {
        position: this.camera.position.clone(),
        yaw: this.yaw,
        pitch: this.pitch,
      };
      this.camera.position.set(0, LIMIT * 1.6, LIMIT * 1.2);
      this.yaw = 0;
      this.pitch = -0.95;
    }
    this.applyLook();
    this.announce();
  }

  private keydown = (event: KeyboardEvent) => {
    if (event.code === 'Tab') {
      event.preventDefault();
      this.cycleFollow(event.shiftKey ? -1 : 1);
      return;
    }
    if (event.code === 'KeyM') {
      this.toggleOverview();
      return;
    }
    if (event.code === 'Escape') {
      this.toFree();
      return;
    }
    if (!MOVE_KEYS.has(event.code)) return;
    event.preventDefault();
    this.keys.add(event.code);
    // Any movement key takes manual control again (standard spectator behaviour).
    if (!event.code.startsWith('Shift')) this.toFree();
  };
  private keyup = (event: KeyboardEvent) => {
    this.keys.delete(event.code);
  };
  private clearKeys = () => this.keys.clear();

  private locked() {
    return document.pointerLockElement === this.renderer.domElement;
  }
  private mousedown = (event: MouseEvent) => {
    if (event.button !== 0 && event.button !== 2) return;
    this.dragging = true;
    if (!this.locked())
      void Promise.resolve(this.renderer.domElement.requestPointerLock()).catch(
        () => {
          /* Denied (e.g. automation or after Escape): drag-to-look still works. */
        },
      );
  };
  private mouseup = () => {
    this.dragging = false;
  };
  private mousemove = (event: MouseEvent) => {
    if (!this.locked() && !this.dragging) return;
    if (this.follow !== undefined) this.toFree();
    this.yaw -= event.movementX * LOOK_SENSITIVITY;
    this.pitch = THREE.MathUtils.clamp(
      this.pitch - event.movementY * LOOK_SENSITIVITY,
      -1.5,
      1.5,
    );
    this.applyLook();
  };
  private wheel = (event: WheelEvent) => {
    event.preventDefault();
    const step = event.deltaY < 0 ? 1 : -1;
    this.speedIndex = THREE.MathUtils.clamp(
      this.speedIndex + step,
      0,
      SPEEDS.length - 1,
    );
    this.announce();
  };
  private noMenu = (event: Event) => event.preventDefault();

  private resize = () => {
    const w = this.host.clientWidth,
      h = this.host.clientHeight;
    this.renderer.setSize(w, h);
    this.camera.aspect = w / Math.max(1, h);
    this.camera.updateProjectionMatrix();
  };

  /** Fly where the camera faces horizontally; Space/Shift move straight up/down. */
  private fly(dt: number) {
    const k = this.keys;
    const forward =
      Number(k.has('KeyW') || k.has('ArrowUp')) -
      Number(k.has('KeyS') || k.has('ArrowDown'));
    const strafe =
      Number(k.has('KeyD') || k.has('ArrowRight')) -
      Number(k.has('KeyA') || k.has('ArrowLeft'));
    const lift =
      Number(k.has('Space')) -
      Number(k.has('ShiftLeft') || k.has('ShiftRight'));
    if (!forward && !strafe && !lift) return;
    const distance = SPEEDS[this.speedIndex] * dt;
    const len = Math.hypot(forward, strafe) || 1;
    const sin = Math.sin(this.yaw),
      cos = Math.cos(this.yaw);
    const p = this.camera.position;
    p.x += ((-sin * forward + cos * strafe) / len) * distance;
    p.z += ((-cos * forward - sin * strafe) / len) * distance;
    p.y += lift * distance;
    const bound = LIMIT * 2;
    p.x = THREE.MathUtils.clamp(p.x, -bound, bound);
    p.z = THREE.MathUtils.clamp(p.z, -bound, bound);
    p.y = THREE.MathUtils.clamp(p.y, 0.2, LIMIT * 3);
  }

  /** Over-the-shoulder camera behind the followed player. */
  private followCamera(avatar: VoxelAvatar, player: Player, dt: number) {
    const target = new THREE.Vector3(
      avatar.position.x + Math.sin(player.yaw) * FOLLOW_BACK,
      avatar.position.y + FOLLOW_UP,
      avatar.position.z + Math.cos(player.yaw) * FOLLOW_BACK,
    );
    this.camera.position.lerp(target, 1 - Math.exp(-6 * dt));
    this.camera.lookAt(
      avatar.position.x,
      avatar.position.y + 1.2,
      avatar.position.z,
    );
    // Keep yaw/pitch in step so free flight continues from this view.
    const euler = new THREE.Euler().setFromQuaternion(
      this.camera.quaternion,
      'YXZ',
    );
    this.yaw = euler.y;
    this.pitch = euler.x;
  }

  private frame = (now: number) => {
    const dt = this.last ? Math.min((now - this.last) / 1000, 0.1) : 0;
    this.last = now;
    const players = this.feed.players;
    if (!this.placed && players.length) {
      this.placeNear(players[0]);
      this.announce();
    }
    if (this.follow !== undefined && !players.some((p) => p.id === this.follow))
      this.toFree();
    if (this.follow === undefined && !this.overview) this.fly(dt);
    const ids = new Set(players.map((p) => p.id));
    for (const [id, avatar] of this.avatars)
      if (!ids.has(id)) {
        this.scene.remove(avatar);
        avatar.dispose();
        this.avatars.delete(id);
      }
    for (const p of players) {
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
      if (p.id === this.follow) this.followCamera(avatar, p, dt);
    }
    this.renderer.render(this.scene, this.camera);
    this.raf = requestAnimationFrame(this.frame);
  };

  dispose() {
    cancelAnimationFrame(this.raf);
    window.removeEventListener('resize', this.resize);
    window.removeEventListener('keydown', this.keydown);
    window.removeEventListener('keyup', this.keyup);
    window.removeEventListener('blur', this.clearKeys);
    document.removeEventListener('mousemove', this.mousemove);
    document.removeEventListener('mouseup', this.mouseup);
    this.renderer.domElement.removeEventListener('mousedown', this.mousedown);
    this.renderer.domElement.removeEventListener('wheel', this.wheel);
    this.renderer.domElement.removeEventListener('contextmenu', this.noMenu);
    if (this.locked()) document.exitPointerLock();
    disposeBlockMeshes(this.scene, this.meshes);
    for (const avatar of this.avatars.values()) avatar.dispose();
    this.renderer.dispose();
    this.renderer.domElement.remove();
  }
}
