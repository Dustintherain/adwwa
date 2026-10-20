/**
 * rigSpec.js — 通用人形骨骼表（纯数据，不 import three）
 *
 * 换角色只改这张表，代码不动。所有比例：
 *   y = 占身高比例（模型整体归一化到 1.48m）
 *   x = 占 halfWidth 比例（左右镜像，左为负、右为正）
 *   z = 占 halfDepth 比例
 *
 * ── 「半宽」与「半深」的口径：见下面两个常量 ────────────────────────────────
 * 两者都从**归一化后 body 网格的顶点包围盒**算，但基准不同：
 *
 *   WIDTH_BASIS = 'bbox-half-span' → halfWidth = (x_max − x_min) / 2
 *       包围盒的半跨度。只依赖包围盒自身，对「原点在哪儿」免疫。koharu = 0.4340m
 *
 *   DEPTH_BASIS = 'max-abs-z'      → halfDepth = max(|z_min|, |z_max|)
 *       相对 **z=0 平面**的最大伸出量。koharu 的 body 在 z 方向并不以 0 对称
 *       （z ∈ [-0.186, 0.284]），半跨度是 0.2349m、最大伸出量是 0.2836m，两者差 17%。
 *       取最大伸出量是为了让分母与 z 值**同一个原点**（z 值就是相对 z=0 平面量的）。
 *
 * 口径怎么定的：不是「半跨度会把手臂判偏前」这种几何直觉，而是**实测**——
 * 同一套关节链只换分母，三段结果就变（radius 固定 0.095m）：
 *
 *   口径              halfDepth   upper / fore / hand   （右手壳 ci28：fore/hand/rest）
 *   'max-abs-z'        0.2836m    105 /  94 / 185       39 / 159 / 43   ← 已核验，取这个
 *   'bbox-half-span'   0.2349m    121 /  77 / 210       33 / 174 / 34
 *   全场半深           0.3187m     92 / 100 / 147       45 / 129 / 67
 *
 * ⚠ 两个基准的**实现**在离线脚本 scripts/lib/koharu.mjs 的 bounds()，它按这两个常量分派。
 *   **运行时侧目前还没有消费 rigSpec.js**（`src/` 下无人 import 本文件），所以并不存在
 *   「运行时共用」——Task 5 起会开始 import。届时 characterModel.js 必须用**同一**口径算
 *   halfDepth，否则 rigSpec 里全部 z 值的含义会静默改变，而所有校验都不会红。
 *
 * ⚠ 留给 Task 5/7 的账：DEPTH_BASIS 相对的是 z=0 平面，而这个平面的原点来自
 *   **整个场景包围盒**的中心（characterModel.js 把 model.position.z 设成场景中心）。
 *   往场景里加任何非 body 的网格（地面、武器），或者把 characterModel.js 改成按 body 居中，
 *   这个平面就会移动，本表里全部 z 值的含义随之静默改变。
 *   届时必须重新标定 z（改法：用 probe-limb-silhouette.mjs 的俯视图对齐手臂）。
 *
 * 关节位置来自对 koharu.glb 的实测（该模型是 A-pose：手臂下垂张开，不是前平举）。
 * 手臂的 x/y/z 取**两段臂管的交汇轴点**（kinematic pivot）而非壳体包围盒的极值——
 * 取极值会把 limbExtract 的走廊整体推离手臂。
 *
 * 标注约定：每个数值后标 [沿用] / [实测]。
 *   [沿用] = 沿用 characterModel.js 既有常数，本表不改；
 *   [实测] = 对 koharu.glb 量出来的，改动时必须同步更新 scripts/check-rig-spec.mjs 的钉子。
 */

/** x 比例的分母口径：包围盒半跨度 (max.x − min.x)/2 */
export const WIDTH_BASIS = 'bbox-half-span';

/**
 * z 比例的分母口径：相对 z=0 平面的最大伸出量 max(|min.z|, |max.z|)。
 * 与 z 值同原点；不免疫原点平移（见文件头的账）。
 */
export const DEPTH_BASIS = 'max-abs-z';

/** 骨骼表 */
export const BONES = [
  // 躯干与头（v1 阶段头与躯干同属 hip 段，不单独切分）
  { name: 'hip', parent: null, y: 0.375, x: 0, z: 0 }, // y [实测] 沿用 characterModel.js 的 HIP_FRAC

  // 左腿（knee/ankle 的 y [实测] 沿用 characterModel.js 的 KNEE_FRAC / ANKLE_FRAC；x/z [初值] v1 腿不横向摆动，先归零）
  { name: 'kneeL', parent: 'hip', y: 0.225, x: 0, z: 0 },
  { name: 'ankleL', parent: 'kneeL', y: 0.061, x: 0, z: 0 },

  // 右腿（同上，与左侧严格镜像）
  { name: 'kneeR', parent: 'hip', y: 0.225, x: 0, z: 0 },
  { name: 'ankleR', parent: 'kneeR', y: 0.061, x: 0, z: 0 },

  // 足（y = 0 是地面基准值，不是从 KNEE_FRAC/ANKLE_FRAC 推出来的；x/z [初值] 同腿，先归零）
  { name: 'footL', parent: 'ankleL', y: 0.0, x: 0, z: 0 },
  { name: 'footR', parent: 'ankleR', y: 0.0, x: 0, z: 0 },

  // 左臂：肩→肘→腕
  //   x = 占 halfWidth 比例，y = 占身高比例，z = 占 halfDepth 比例（口径见文件头的两个常量）
  //   关节取**两段臂管的交汇轴点**，不是壳体包围盒的极值——
  //   取极值会把走廊整体推离手臂。三个值由 Task 4 实测标定，
  //   密度图入口：node scripts/probe-limb-silhouette.mjs --density
  { name: 'shoulderL', parent: 'hip', y: 0.527, x: -0.44, z: 0.55 },
  { name: 'elbowL', parent: 'shoulderL', y: 0.419, x: -0.58, z: 0.34 },
  { name: 'handL', parent: 'elbowL', y: 0.372, x: -0.77, z: 0.49 },

  // 右臂：肩→肘→腕（与左侧严格镜像）
  { name: 'shoulderR', parent: 'hip', y: 0.527, x: 0.44, z: 0.55 },
  { name: 'elbowR', parent: 'shoulderR', y: 0.419, x: 0.58, z: 0.34 },
  { name: 'handR', parent: 'elbowR', y: 0.372, x: 0.77, z: 0.49 },
];

/** 全部骨名 */
export const BONE_NAMES = BONES.map((b) => b.name);

/** 骨名 -> 骨，供 LEG_PLANES 派生取用（避免二次真值） */
const boneByName = new Map(BONES.map((b) => [b.name, b]));

/**
 * 手臂分段：chain 为肩→肘→腕；cuts 为切面所在关节。
 * 切面法线 = 该关节指向下一关节的方向；腕的切面沿用肘的方向。
 * [实测] 结构本身来自 koharu.glb 的壳体拓扑：上臂与躯干同属一个连通壳体，
 *        只有前臂与手是独立壳体，故 cut 只落在肩与肘。
 */
export const ARM_SEGMENTS = {
  R: { chain: ['shoulderR', 'elbowR', 'handR'], cuts: ['shoulderR', 'elbowR'] },
  L: { chain: ['shoulderL', 'elbowL', 'handL'], cuts: ['shoulderL', 'elbowL'] },
};

/**
 * 持枪初始旋转（欧拉角 XYZ，弧度）。肩抬起、前臂内收、手腕对齐枪身。
 * [初值] 全部六个三元组都是经验值，Task 7 上屏校准后写回本表。
 */
export const ARM_POSE = {
  R: {
    shoulder: [-1.15, -0.35, -0.25],
    elbow: [-0.85, 0.0, 0.15],
    hand: [0.1, 0.0, 0.25],
  },
  L: {
    shoulder: [-1.05, 0.45, 0.3],
    elbow: [-1.15, 0.0, -0.2],
    hand: [0.1, 0.0, -0.2],
  },
};

/**
 * 腿部水平切面高度（占身高比例），沿用 characterModel 现有口径。
 * [实测] hipY/kneeY/ankleY 与 BONES 里同名的腿骨是同一组物理量，
 *        因此不再写第二份字面量——全部由 BONES 派生，改骨高自动跟随。
 */
export const LEG_PLANES = {
  hipY: boneByName.get('hip').y,
  kneeY: boneByName.get('kneeL').y,
  ankleY: boneByName.get('ankleL').y,
};

/**
 * 手臂走廊：沿线段 shoulder→elbow→hand 的带状区域（米制三维判据，见 limbExtract.js）。
 * halfWidthRatio = 走廊半宽 = halfWidthRatio × halfWidth。
 *
 * 这里**故意没有**「沿链方向超出首尾关节的余量」这个参数：limbExtract 的投影把参数钳到 [0,1]，
 * 弧长恒在 [0, total]，任何轴向上限都恒等于 no-op——加了只会变成「改了却什么都不变」的静默陷阱。
 * 实测：把它做成真正的轴向硬上限后，当前值 0.044m 会让手部段从 185 面掉到 104 面
 * （手掌几乎沿链轴方向延伸），要恢复得放宽到 ≥0.12m，而那时它对本模型又不再生效。
 * 真需要轴向约束时，带实测值重新引入。
 *
 * [实测] halfWidthRatio 由 Task 4 的轮廓/密度图实测标定，Task 7 上屏后可能再收放。
 */
export const ARM_CORRIDOR = {
  halfWidthRatio: 0.24, // [实测] 0.24 完整涵盖袖管边界三角面，杜绝底部缺块
};
