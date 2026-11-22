import test from "node:test";
import assert from "node:assert/strict";
import model from "./public/model.js";

const { createPlan, validatePlan, assignGuest, linkGuests, unlinkGuest, moveGuestToSeat, clampPosition, tableSize, removeRoom, removeTable } = model;

function fixture() {
  return {
    ...createPlan(),
    rooms: [{ id: "room1", name: "Main hall", width: 12, height: 8 }, { id: "room2", name: "Lounge", width: 6, height: 6 }],
    tables: [
      { id: "table1", roomId: "room1", name: "Table 1", shape: "round", capacity: 1, width: 2, height: 2, x: 1, y: 1, rotation: 0 },
      { id: "table2", roomId: "room2", name: "Table 2", shape: "rectangle", capacity: 2, width: 3, height: 1, x: 0, y: 0, rotation: 90 },
    ],
    guests: [{ id: "guest1", name: "Alex", tableId: "table1" }, { id: "guest2", name: "Sam", tableId: null }],
  };
}

test("linked guests move together and respect capacity", () => {
  const plan = fixture();
  assert.throws(() => linkGuests(plan, "guest1", "guest2"), /room for all 2/);
  const two = fixture();
  two.guests[0].tableId = null;
  linkGuests(two, "guest1", "guest2");
  assignGuest(two, "guest2", "table2");
  assert.deepEqual(two.guests.map(guest => guest.tableId), ["table2", "table2"]);
  assert.throws(() => assignGuest(two, "guest1", "table1"), /room for all 2/);
  unlinkGuest(two, "guest1");
  assert.equal(validatePlan(two).guests.some(guest => guest.linkId), false);
});

test("a link left with one guest is dropped on validation", () => {
  const plan = fixture();
  plan.guests[0].linkId = "solo";
  assert.equal(validatePlan(plan).guests[0].linkId, undefined);
});

test("assignment enforces capacity without losing an existing assignment", () => {
  const plan = fixture();
  assignGuest(plan, "guest1", "table1");
  assert.throws(() => assignGuest(plan, "guest2", "table1"), /full/);
  assert.equal(plan.guests[1].tableId, null);
  assignGuest(plan, "guest1", "table2");
  assignGuest(plan, "guest2", "table1");
  assignGuest(plan, "guest1", null);
  assert.equal(plan.guests[0].tableId, null);
  assert.throws(() => assignGuest(plan, "missing", null), /no longer exists/);
  assert.throws(() => assignGuest(plan, "guest1", "missing"), /no longer exists/);
});

test("drag bounds account for rotated rectangular tables", () => {
  const plan = fixture();
  assert.deepEqual(tableSize(plan.tables[1]), { width: 1, height: 3 });
  assert.deepEqual(clampPosition(plan.tables[1], plan.rooms[1], 20, -5), { x: 5, y: 0 });
  assert.deepEqual(clampPosition(plan.tables[1], plan.rooms[1], -1, 20), { x: 0, y: 3 });
});

test("deleting rooms or tables unseats affected guests and preserves other rooms", () => {
  const plan = fixture();
  assignGuest(plan, "guest2", "table2");
  removeRoom(plan, "room1");
  assert.equal(plan.guests[0].tableId, null);
  assert.equal(plan.guests[1].tableId, "table2");
  assert.deepEqual(plan.rooms.map(room => room.id), ["room2"]);
  assert.deepEqual(plan.tables.map(table => table.id), ["table2"]);
  removeTable(plan, "table2");
  assert.equal(plan.guests[1].tableId, null);
  assert.doesNotThrow(() => validatePlan(plan));
});

test("moving a guest within a table reorders only that table's guests", () => {
  const plan = {
    ...createPlan(),
    rooms: [{ id: "r", name: "R", width: 10, height: 10 }],
    tables: [
      { id: "a", roomId: "r", name: "A", shape: "round", capacity: 4, width: 2, height: 2, x: 0, y: 0, rotation: 0 },
      { id: "b", roomId: "r", name: "B", shape: "round", capacity: 4, width: 2, height: 2, x: 4, y: 4, rotation: 0 },
    ],
    guests: ["a", "b", "a", "a"].map((tableId, index) => ({ id: `g${index}`, name: `G${index}`, tableId })),
  };
  const seats = tableId => plan.guests.filter(guest => guest.tableId === tableId).map(guest => guest.id);
  moveGuestToSeat(plan, "g3", 0);
  assert.deepEqual(seats("a"), ["g3", "g0", "g2"]);
  assert.deepEqual(seats("b"), ["g1"]);
  assert.equal(plan.guests[1].id, "g1");
  moveGuestToSeat(plan, "g3", 99);
  assert.deepEqual(seats("a"), ["g0", "g2", "g3"]);
  plan.guests[1].tableId = null;
  assert.throws(() => moveGuestToSeat(plan, "g1", 0), /not seated/);
});

test("export/import round trip preserves geometry and assignments without sharing references", () => {
  const original = fixture();
  const imported = validatePlan(JSON.parse(JSON.stringify(original)));
  assert.deepEqual(imported, original);
  imported.guests[0].name = "Changed";
  assert.equal(original.guests[0].name, "Alex");
  assert.deepEqual(validatePlan(createPlan()), createPlan());
});

test("import rejects invalid references, IDs, geometry and over-capacity tables", () => {
  const cases = [
    [plan => { plan.version = 2; }, /Unsupported/],
    [plan => { plan.guests[1].id = "table1"; }, /Duplicate ID/],
    [plan => { plan.tables[0].roomId = "absent"; }, /missing room/],
    [plan => { plan.guests[0].tableId = "absent"; }, /missing table/],
    [plan => { plan.guests[1].tableId = "table1"; }, /more guests/],
    [plan => { plan.tables[0].capacity = 1.5; }, /whole number/],
    [plan => { plan.tables[0].height = 3; }, /equal width/],
    [plan => { plan.tables[1].y = 4; }, /fit inside/],
    [plan => { plan.tables[0].width = 15; plan.tables[0].height = 15; }, /fit inside/],
    [plan => { plan.rooms[0].width = NaN; }, /between/],
    [plan => { plan.guests[0].name = " "; }, /characters/],
    [plan => { plan.tables[0].rotation = 45; }, /rotation/],
    [plan => { plan.guests = {}; }, /guests array/],
  ];
  for (const [mutate, message] of cases) {
    const plan = fixture();
    mutate(plan);
    assert.throws(() => validatePlan(plan), message);
  }
});
