import { describe, expect, it } from "vitest";
import {
  SIZE,
  SLOT,
  planFloor,
  routeBetween,
  routeLength,
  scaleFor,
  spotAt,
  type FloorPlan,
  type PlanTeam,
} from "./floor-plan.js";

function team(id: string, size: number): PlanTeam {
  return { id, name: id, members: Array.from({ length: size }, (_, index) => `${id}-${index}`) };
}

interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

function overlap(a: Box, b: Box): boolean {
  return a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
}

function wallBoxes(plan: FloorPlan): Box[] {
  return [
    ...plan.shelves.map((at) => ({ ...at, ...SIZE.shelves })),
    { ...plan.board, ...SIZE.board },
    ...plan.racks.map((at) => ({ ...at, ...SIZE.rack })),
  ];
}

function loungeBoxes(plan: FloorPlan): Box[] {
  const person = (x: number, y: number) => ({ x, y, ...SIZE.person });
  return [
    ...(plan.sofa === null ? [] : [{ ...plan.sofa, ...SIZE.sofa }]),
    { ...plan.plant, ...SIZE.plant },
    { ...plan.coffee, ...SIZE.coffee },
    { ...plan.cart, ...SIZE.cart, w: SIZE.cart.w - 1 },
    person(plan.janitor.x, plan.janitor.y),
    { ...plan.rocket, ...SIZE.rocket },
    ...plan.spots.coffee.xs.map((x) => person(x, plan.spots.coffee.y)),
    ...plan.spots.pad.xs.map((x) => person(x, plan.spots.pad.y)),
  ];
}

describe("scaleFor", () => {
  it("is 2 on a phone, grows with the surface and stops at 4", () => {
    expect([280, 320, 390, 599, 800, 960, 1120, 1280, 1600, 2560].map(scaleFor)).toEqual([
      1, 2, 2, 2, 2, 3, 3, 4, 4, 4,
    ]);
  });
});

describe("planFloor", () => {
  it("seats a phone's teams four to a row, each team under its plate", () => {
    const plan = planFloor([team("a", 5), team("b", 1)], 390);
    expect(plan.scale).toBe(2);
    expect(plan.width).toBe(195);
    expect(plan.plates.map((plate) => [plate.id, plate.count, plate.width])).toEqual([
      ["a", 5, 4 * SLOT],
      ["b", 1, SLOT],
    ]);
    const rows = [...new Set(plan.desks.filter((desk) => desk.teamId === "a").map((d) => d.y))];
    expect(rows).toHaveLength(2);
    const [first, second] = plan.plates;
    expect(first && second && second.y).toBeGreaterThan((rows[1] ?? 0) + SIZE.desk.h);
  });

  it("gives a team without members no plate and no desks", () => {
    const plan = planFloor([team("a", 0), team("b", 2)], 390);
    expect(plan.plates.map((plate) => plate.id)).toEqual(["b"]);
    expect(plan.desks).toHaveLength(2);
  });

  it("draws the room with nobody in it", () => {
    const plan = planFloor([], 390);
    expect(plan.desks).toEqual([]);
    expect(plan.height).toBeGreaterThan(plan.loungeY);
    expect(plan.loungeY).toBeGreaterThan(plan.wallHeight);
  });

  it.each([300, 320, 360, 390, 600, 800, 960, 1120, 1280, 1600, 2560])(
    "keeps everything inside a %i px room, with no two things on one spot",
    (widthPx) => {
      const plan = planFloor([team("a", 7), team("b", 3)], widthPx);
      const desks = plan.desks.map((desk) => ({ x: desk.x, y: desk.y, ...SIZE.desk }));
      for (const group of [wallBoxes(plan), loungeBoxes(plan), desks]) {
        for (const box of group) {
          expect(box.x).toBeGreaterThanOrEqual(0);
          expect(box.x + box.w).toBeLessThanOrEqual(plan.width);
          expect(box.y + box.h).toBeLessThanOrEqual(plan.height);
        }
        group.forEach((box, index) => {
          for (const other of group.slice(index + 1)) expect(overlap(box, other)).toBe(false);
        });
      }
      // The lane is free: nothing a person would walk through stands in it.
      const lane = { x: plan.laneX, y: plan.wallHeight, ...SIZE.person, h: plan.height };
      for (const box of [...desks, ...loungeBoxes(plan)]) expect(overlap(lane, box)).toBe(false);
    },
  );

  it("leaves an aisle behind every chair that clears the next row's screens", () => {
    const plan = planFloor([team("a", 9)], 390);
    const [first] = plan.desks;
    const below = plan.desks.find((desk) => first !== undefined && desk.y > first.y);
    expect(first && below && first.aisleY + SIZE.person.h).toBeLessThanOrEqual(below?.y ?? 0);
    expect(first && first.aisleY).toBeGreaterThanOrEqual(
      (first?.seat.y ?? 0) + SIZE.seated.h + plan.tagHeight,
    );
  });

  it("parks the janitor's cart in the lounge, with the janitor on the lounge's line", () => {
    for (const widthPx of [300, 390, 1280]) {
      const plan = planFloor([team("a", 3)], widthPx);
      expect(plan.janitor.y).toBe(plan.spots.coffee.y);
      expect(plan.cart.y + SIZE.cart.h).toBe(plan.plant.y + SIZE.plant.h);
    }
    // A narrow room has one place at the coffee machine, and a wide one two at the pad.
    expect(planFloor([], 300).spots.coffee.xs).toHaveLength(1);
    expect(planFloor([], 360).spots.pad.xs).toHaveLength(1);
    expect(planFloor([], 390).spots.pad.xs).toHaveLength(2);
  });

  it("has two places on the sofa and one at the plant, clear of who stands at the machine", () => {
    for (const widthPx of [360, 390, 800, 1280]) {
      const plan = planFloor([team("a", 3)], widthPx);
      const { sofa, plant, coffee } = plan.spots;
      expect(sofa.xs).toHaveLength(2);
      expect(plant.xs).toHaveLength(1);
      const resting = [
        ...sofa.xs.map((x) => ({ x, y: sofa.y, ...SIZE.person })),
        ...plant.xs.map((x) => ({ x, y: plant.y, ...SIZE.person })),
        ...coffee.xs.map((x) => ({ x, y: coffee.y, ...SIZE.person })),
      ];
      resting.forEach((box, index) => {
        for (const other of resting.slice(index + 1)) expect(overlap(box, other)).toBe(false);
      });
      // Both sit within the sofa's width, and nobody stands in the lane.
      const lane = { x: plan.laneX, y: plan.wallHeight, ...SIZE.person, h: plan.height };
      for (const box of resting) expect(overlap(lane, box)).toBe(false);
      for (const x of sofa.xs) {
        expect(x).toBeGreaterThanOrEqual(plan.sofa?.x ?? 0);
        expect(x + SIZE.person.w).toBeLessThanOrEqual((plan.sofa?.x ?? 0) + SIZE.sofa.w);
      }
      expect(plant.y).toBe(coffee.y);
    }
    // A room too narrow for a sofa has no place on one; the plant is still there.
    const narrow = planFloor([], 300);
    expect(narrow.sofa).toBeNull();
    expect(narrow.spots.sofa.xs).toEqual([]);
    expect(narrow.spots.plant.xs).toHaveLength(1);
    expect(narrow.spots.plant.xs[0]).toBeGreaterThan(narrow.laneX + SIZE.person.w);
  });

  it("has more shelves in a wider room and one rack in a narrow one", () => {
    expect(planFloor([], 300).racks).toHaveLength(1);
    expect(planFloor([], 390).shelves).toHaveLength(1);
    expect(planFloor([], 1280).shelves).toHaveLength(2);
    expect(planFloor([], 2560).shelves).toHaveLength(3);
    expect(planFloor([], 1280).spots.library.xs).toHaveLength(8);
    expect(planFloor([], 1280).width).toBe(320);
  });
});

describe("spotAt", () => {
  it("fills a place side by side, then a step in front", () => {
    const spots = { y: 34, xs: [10, 23] };
    expect([0, 1, 2, 3].map((index) => spotAt(spots, index))).toEqual([
      { x: 10, y: 34 },
      { x: 23, y: 34 },
      { x: 15, y: 37 },
      { x: 28, y: 37 },
    ]);
  });
});

describe("routeBetween", () => {
  const laneX = 7;

  it("leaves the aisle for the lane, goes along it and turns in", () => {
    const corners = routeBetween({ x: 60, y: 100 }, { x: 40, y: 34 }, laneX);
    expect(corners).toEqual([
      { x: 7, y: 100 },
      { x: 7, y: 34 },
      { x: 40, y: 34 },
    ]);
    expect(routeLength({ x: 60, y: 100 }, corners)).toBe(53 + 66 + 33);
  });

  it("walks straight along one line", () => {
    expect(routeBetween({ x: 60, y: 34 }, { x: 20, y: 34 }, laneX)).toEqual([{ x: 20, y: 34 }]);
  });

  it("starts from the lane when a walk is turned round in it", () => {
    expect(routeBetween({ x: 7, y: 80 }, { x: 60, y: 100 }, laneX)).toEqual([
      { x: 7, y: 100 },
      { x: 60, y: 100 },
    ]);
  });

  it("goes nowhere when it is there", () => {
    expect(routeBetween({ x: 5, y: 5 }, { x: 5, y: 5 }, laneX)).toEqual([]);
  });
});
