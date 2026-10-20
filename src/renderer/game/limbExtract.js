// limbExtract.js — 四肢网格提取（纯 TypedArray 计算，不依赖 three.js）
//
// 输入：角色网格（已归一化到米制）+ 肢体的关节链位置
// 输出：上段/中段/末段的**三角形索引**（全局索引），交由 meshTools 打包成几何体
//
// 关键约定：坐标系必须与运行时一致——即已应用 GLB 的节点变换（根节点常带
// Z-up→Y-up 转换矩阵）。用原始 accessor 坐标会得到完全不同的结果。

/** 重合顶点量化倍率（米制，1mm）。UV 缝处会有位置相同但索引不同的顶点。 */
const KEY_SCALE = 1000;

function vecSub(a, b) {
  return [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
}

function vecDot(a, b) {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}

function vecLen(a) {
  return Math.hypot(a[0], a[1], a[2]);
}

/**
 * 按重合顶点做并查集，把网格分成连通分量。
 * 返回 { comps: number[][]（每个分量的**去重**顶点索引）, triOf: number[]（每个三角形的分量序号） }
 */
export function buildComponents(positions, indices) {
  const vcount = positions.length / 3;
  const rep = new Int32Array(vcount);
  const keyToRep = new Map();
  for (let i = 0; i < vcount; i++) {
    const key =
      Math.round(positions[i * 3] * KEY_SCALE) +
      ',' + Math.round(positions[i * 3 + 1] * KEY_SCALE) +
      ',' + Math.round(positions[i * 3 + 2] * KEY_SCALE);
    if (keyToRep.has(key)) rep[i] = keyToRep.get(key);
    else {
      keyToRep.set(key, i);
      rep[i] = i;
    }
  }

  const parent = new Int32Array(vcount);
  for (let i = 0; i < vcount; i++) parent[i] = i;
  const find = (x) => {
    let r = x;
    while (parent[r] !== r) r = parent[r];
    while (parent[x] !== r) {
      const next = parent[x];
      parent[x] = r;
      x = next;
    }
    return r;
  };
  const union = (a, b) => {
    const ra = find(a);
    const rb = find(b);
    if (ra !== rb) parent[ra] = rb;
  };

  const triCount = indices.length / 3;
  for (let t = 0; t < triCount; t++) {
    union(rep[indices[t * 3]], rep[indices[t * 3 + 1]]);
    union(rep[indices[t * 3]], rep[indices[t * 3 + 2]]);
  }

  const compIndex = new Map();
  const comps = [];
  const triOf = new Array(triCount);
  for (let t = 0; t < triCount; t++) {
    const r = find(rep[indices[t * 3]]);
    let ci = compIndex.get(r);
    if (ci === undefined) {
      ci = comps.length;
      compIndex.set(r, ci);
      comps.push(new Set());
    }
    triOf[t] = ci;
    for (let k = 0; k < 3; k++) comps[ci].add(indices[t * 3 + k]);
  }
  // 对外仍是普通数组（调用方只读），但分量内已去重：相邻去重会漏掉跨三角形重复的顶点
  return { comps: comps.map((s) => [...s]), triOf };
}

/**
 * 把点投影到折线上，返回 { t: 沿折线的弧长参数, d: 到折线的横向距离 }。
 * 折线由 chain 的三个点构成（肩→肘→腕）。
 */
function projectToPolyline(p, chain) {
  const segLen = [vecLen(vecSub(chain[1], chain[0])), vecLen(vecSub(chain[2], chain[1]))];
  const total = segLen[0] + segLen[1];
  if (total < 1e-9) return { t: 0, d: vecLen(vecSub(p, chain[0])) };

  let best = { t: 0, d: Infinity };
  for (let s = 0; s < 2; s++) {
    const a = chain[s];
    const b = chain[s + 1];
    const ab = vecSub(b, a);
    const l2 = vecDot(ab, ab);
    const ap = vecSub(p, a);
    let u = l2 > 1e-12 ? vecDot(ap, ab) / l2 : 0;
    u = u < 0 ? 0 : u > 1 ? 1 : u;
    const proj = [a[0] + ab[0] * u, a[1] + ab[1] * u, a[2] + ab[2] * u];
    const d = vecLen(vecSub(p, proj));
    if (d < best.d) {
      // 弧长参数 = 已走过的整段长 + 本段内插值。第二段的整段长是 segLen[0]（不是 segLen[1]）
      const arc = (s > 0 ? segLen[s - 1] : 0) + u * segLen[s];
      best = { t: arc, d };
    }
  }
  return { t: best.t, d: best.d };
}

/**
 * 提取一条肢体，切成上段/中段/末段三组三角形。
 *
 * 判据只有一条：**三角形质心到关节链折线的三维距离 ≤ 走廊半宽**。
 * 再按质心沿折线的弧长参数（钳在 [0,total]）落到哪一段划分（上段 < 肘 < 中段 < 腕 < 末段）。
 *
 * koharu 的 body 是**一个大壳**（躯干 + 裙摆 + 双上臂 + 双前臂在拓扑上相连），
 * 排除躯干靠的就是上面那一条——关节链贴着臂管走，躯干表面落在走廊内侧，
 * 半径收得够小就切不到它。实测 radius = 0.095m（halfWidthRatio 0.22）时三段连续且不吞躯干；
 * 放宽到 0.18m 会把躯干核心吞进 141 面。**没有别的排除机制**：链轴方向不设上限
 * （projectToPolyline 把投影参数钳到 [0,1]，弧长恒落在 [0,total]），
 * 所以也不存在、不该再引入「轴向余量」参数——加了必然是恒等于 no-op 的死旋钮
 * （详见 rigSpec.js 的 ARM_CORRIDOR 注释）。
 *
 * @param {object} input
 * @param {Float32Array|number[]} input.positions 顶点，米制，已应用模型节点变换
 * @param {Uint32Array|number[]} input.indices  三角形索引
 * @param {{x:number,y:number,z:number}[]} input.chain 肩→肘→腕三个关节的绝对位置
 * @param {number} input.corridorHalfWidth 走廊半宽（米）
 * @param {number} [input.halfWidth] **当前实现未使用**，保留以匹配接口契约（调用方按契约传）
 * @param {{x:number,y:number,z:number}} [input.up] **当前实现未使用**，保留以匹配接口契约；
 *   走廊判据只依赖「到折线的三维距离」，不需要切面基底。Task 5 若改为按切面切走廊时才用得上。
 * @returns {{ok:boolean, reason?:string, upper:number[], fore:number[], hand:number[], rest:number[]}}
 *   **所有分支的返回形状一致**（失败时四个数组也存在），调用方可以直接读 seg.upper.length，
 *   不会因缺字段抛 TypeError——全局约束要求「降级不可见、绝不抛异常阻断游戏」。
 *
 * 走廊半宽是**米制三维**判据，chain 的 z 必须和手臂轴的 z 同量级，否则整条手臂会掉出走廊。
 * 链的 z 由 rigSpec.js 给出，其分母口径见 rigSpec.js 头部的 WIDTH_BASIS / DEPTH_BASIS。
 */
export function extractLimbSegments(input) {
  const { positions, indices, corridorHalfWidth } = input;
  const triCount = indices.length / 3;

  // 关节链按 {x,y,z} 传入（与 rigSpec 的骨骼表同构），这里归一成 [x,y,z] 供向量工具函数使用
  const chain = input.chain.map((p) => [p.x, p.y, p.z]);

  // 折线总长与两段的分界弧长
  const l0 = vecLen(vecSub(chain[1], chain[0]));
  const l1 = vecLen(vecSub(chain[2], chain[1]));
  const total = l0 + l1;
  if (total < 1e-6) return { ok: false, reason: 'degenerate-chain', upper: [], fore: [], hand: [], rest: [] };

  // 1. 自动识别独立手部连通分量（避免几何粗暴截切导致手掌被腰斩断裂与拉丝）
  const { comps, triOf } = buildComponents(positions, indices);
  const handTarget = chain[2];
  let handComp = -1;
  let bestDist = Infinity;
  for (let c = 0; c < comps.length; c++) {
    if (comps[c].length < 20) continue;
    let cx = 0, cy = 0, cz = 0;
    for (const v of comps[c]) {
      cx += positions[v * 3];
      cy += positions[v * 3 + 1];
      cz += positions[v * 3 + 2];
    }
    cx /= comps[c].length;
    cy /= comps[c].length;
    cz /= comps[c].length;
    const d = Math.hypot(cx - handTarget[0], cy - handTarget[1], cz - handTarget[2]);
    if (d < bestDist && d < 0.15) {
      bestDist = d;
      handComp = c;
    }
  }

  const upper = [];
  const fore = [];
  const hand = [];
  const used = new Uint8Array(triCount);

  for (let t = 0; t < triCount; t++) {
    const c = triOf[t];
    // 独立手部网格完整归属末段手掌，避免手部三角面被撕裂
    if (c === handComp) {
      used[t] = 1;
      hand.push(t);
      continue;
    }

    // 排除水手领披肩（c===2）及躯干核心区（|cx| < 0.115m），防止将躯干与衣领破面扯入胳膊，同时完整保留内侧与底部袖管三角面
    if (c === 2) continue;
    const i0 = indices[t * 3];
    const i1 = indices[t * 3 + 1];
    const i2 = indices[t * 3 + 2];
    const cx = (positions[i0 * 3] + positions[i1 * 3] + positions[i2 * 3]) / 3;
    const cy = (positions[i0 * 3 + 1] + positions[i1 * 3 + 1] + positions[i2 * 3 + 1]) / 3;
    const cz = (positions[i0 * 3 + 2] + positions[i1 * 3 + 2] + positions[i2 * 3 + 2]) / 3;
    if (Math.abs(cx) < 0.115) continue;

    const { t: arc, d } = projectToPolyline([cx, cy, cz], chain);
    if (d > corridorHalfWidth) continue;

    used[t] = 1;
    if (arc < l0) upper.push(t);
    else fore.push(t);
  }

  // 补集：未归属三段的三角形（调用方用它重建躯干）
  const rest = [];
  for (let t = 0; t < triCount; t++) if (!used[t]) rest.push(t);

  if (fore.length === 0 || hand.length === 0) {
    return {
      ok: false,
      reason: `empty-segment upper=${upper.length} fore=${fore.length} hand=${hand.length}`,
      upper,
      fore,
      hand,
      rest,
    };
  }
  return { ok: true, upper, fore, hand, rest };
}
