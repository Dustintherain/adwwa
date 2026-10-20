// scripts/lib/koharu.mjs — 离线脚本共用的「加载 GLB + 归一化 + 取 body 网格」入口
//
// 为什么必须共用一份：这段逻辑要和运行时（src/renderer/game/characterModel.js）**同一口径**——
// 必须用真实 GLTFLoader 解析并应用 GLB 节点变换（koharu 的根节点带 Sketchfab 的
// Z-up→Y-up 转换矩阵 diag(1,-1,-1) + 大平移）。上一轮项目就是栽在「用原始 accessor
// 坐标、忽略节点变换」上——阈值全在镜像坐标系里标定，实机完全失效。
// 复制两份必然只改一处，故抽成唯一入口。

import fs from 'node:fs';
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { BONES, ARM_CORRIDOR, WIDTH_BASIS, DEPTH_BASIS } from '../../src/renderer/game/rigSpec.js';

/** 归一化目标身高（与 characterModel.js 的 targetHeight 一致） */
export const TARGET_HEIGHT = 1.48;

/** body 网格在 GLB 里的材质名 */
const BODY_MATERIAL = 'body';

/**
 * 加载 koharu.glb，按 characterModel.js 的口径归一化到 TARGET_HEIGHT，返回 body 网格的
 * 顶点（已应用 matrixWorld，米制）/ 索引 / 包围盒。
 *
 * 贴图引用在解析前被剥掉：Node 没有 ImageBitmap，留着会让 GLTFLoader 直接抛错。
 */
export async function loadBody(modelUrl = new URL('../../public/models/koharu.glb', import.meta.url)) {
  const buf = fs.readFileSync(modelUrl);
  const jsonLen = buf.readUInt32LE(12);
  const json = JSON.parse(buf.subarray(20, 20 + jsonLen).toString('utf8'));
  json.textures = [];
  json.images = [];
  for (const m of json.materials || []) {
    if (m.pbrMetallicRoughness) delete m.pbrMetallicRoughness.baseColorTexture;
  }
  const nj = Buffer.from(JSON.stringify(json), 'utf8');
  Buffer.concat([nj, Buffer.alloc(jsonLen - nj.length, 0x20)]).copy(buf, 20);

  const gltf = await new Promise((res, rej) =>
    new GLTFLoader().parse(
      buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.length),
      '',
      res,
      rej
    )
  );

  const model = gltf.scene;
  model.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(model);
  const size = box.getSize(new THREE.Vector3());
  const center = box.getCenter(new THREE.Vector3());
  const scale = TARGET_HEIGHT / size.y;
  model.position.set(-center.x * scale, -box.min.y * scale, -center.z * scale);
  model.scale.setScalar(scale);
  model.updateMatrixWorld(true);

  let body = null;
  model.traverse((c) => {
    if (c.isMesh && c.material && c.material.name === BODY_MATERIAL && !body) body = c;
  });
  if (!body) throw new Error('未找到 body 网格');

  const posAttr = body.geometry.attributes.position;
  const count = posAttr.count;
  const positions = new Float32Array(count * 3);
  const v = new THREE.Vector3();
  for (let i = 0; i < count; i++) {
    v.fromBufferAttribute(posAttr, i).applyMatrix4(body.matrixWorld);
    positions[i * 3] = v.x;
    positions[i * 3 + 1] = v.y;
    positions[i * 3 + 2] = v.z;
  }
  const indices = Uint32Array.from(body.geometry.index.array);

  return { positions, indices, ...bounds(positions) };
}

/**
 * 顶点数组的包围盒，以及 rigSpec 的 x/z 比例所需的两个分母。
 *
 * 分母口径由 rigSpec.js 的 WIDTH_BASIS / DEPTH_BASIS 决定，这里只负责按常量分派，
 * 这样离线脚本与将来的运行时实现读的是同一份约定，不会各写各的。
 *
 * 未知口径直接抛错而不是静默回退——口径搞错会让所有 z 值无声地偏移 17%。
 */
export function bounds(positions) {
  const lo = [Infinity, Infinity, Infinity];
  const hi = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < positions.length / 3; i++) {
    for (let k = 0; k < 3; k++) {
      const a = positions[i * 3 + k];
      if (a < lo[k]) lo[k] = a;
      if (a > hi[k]) hi[k] = a;
    }
  }
  if (WIDTH_BASIS === 'bbox-half-span') {
    var halfWidth = (hi[0] - lo[0]) / 2;
  } else {
    throw new Error(`未知的 WIDTH_BASIS: ${WIDTH_BASIS}`);
  }
  if (DEPTH_BASIS === 'max-abs-z') {
    var halfDepth = Math.max(Math.abs(lo[2]), Math.abs(hi[2]));
  } else {
    throw new Error(`未知的 DEPTH_BASIS: ${DEPTH_BASIS}`);
  }
  return { lo, hi, halfWidth, halfDepth };
}

/**
 * 由 rigSpec.js 生成一条手臂的关节链与走廊参数（绝对值，米制）。
 * 换算口径沿用 rigSpec.js 头部的声明：x 占半宽、y 占身高、z 占半深。
 * 骨骼表的 y 是唯一真值来源，校准只改 rigSpec.js，不改脚本。
 */
export function armChain(side, { halfWidth, halfDepth }) {
  const suffix = side === 'L' ? 'L' : 'R';
  const bone = (n) => {
    const b = BONES.find((x) => x.name === n + suffix);
    if (!b) throw new Error(`rigSpec 里没有骨 ${n}${suffix}`);
    return b;
  };
  return {
    chain: ['shoulder', 'elbow', 'hand'].map((n) => {
      const b = bone(n);
      return { x: b.x * halfWidth, y: b.y * TARGET_HEIGHT, z: b.z * halfDepth };
    }),
    corridorHalfWidth: ARM_CORRIDOR.halfWidthRatio * halfWidth,
  };
}

/** 把三角形序号数组换算成包围盒（诊断/断言用） */
export function triBounds(positions, indices, tris) {
  const lo = [Infinity, Infinity, Infinity];
  const hi = [-Infinity, -Infinity, -Infinity];
  for (const t of tris) {
    for (let k = 0; k < 3; k++) {
      const i = indices[t * 3 + k];
      for (let c = 0; c < 3; c++) {
        const a = positions[i * 3 + c];
        if (a < lo[c]) lo[c] = a;
        if (a > hi[c]) hi[c] = a;
      }
    }
  }
  if (!tris.length) return null;
  return { lo, hi };
}
