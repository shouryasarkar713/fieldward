#!/usr/bin/env node
/**
 * Final check: every image URL used by the seed data must resolve (200/206).
 */
const FINAL = {
  backpacks: [
    "photo-1553062407-98eeb64c6a62",
    "photo-1510353157186-4e5fec7beb6d",
    "photo-1440186347098-386b7459ad6b",
    "photo-1476297820623-03984cf5cdbb",
    "photo-1542317279-72571d7a779a",
    "photo-1501555088652-021faa106b9b",
    "photo-1496055024442-2606697dee3d",
  ],
  footwear: [
    "photo-1576760994270-85335a1c613c",
    "photo-1600185365483-26d7a4cc7519",
    "photo-1556912743-90a361c19b16",
    "photo-1422728221357-57980993ea99",
    "photo-1547919307-39751fd99411",
    "photo-1549298916-b41d501d3772",
    "photo-1489031394173-5112ea733006",
  ],
  shelter: [
    "photo-1504280390367-361c6d9f38f4",
    "photo-1510312305653-8ed496efae75",
    "photo-1533873984035-25970ab07461",
    "photo-1543362137-396c385ae95d",
    "photo-1508873696983-2dfd5898f08b",
    "photo-1537905569824-f89f14cceb68",
    "photo-1478131143081-80f7f84ca84d",
  ],
  cook: [
    "photo-1444012104069-996724bf4a0a",
    "photo-1512058564366-18510be2db19",
    "photo-1470337458703-46ad1756a187",
    "photo-1504754524776-8f4f37790ca0",
    "photo-1496733570428-49657ca2f9cf",
    "photo-1524484485831-a92ffc0de03f",
    "photo-1502943693086-33b5b1cfdf2f",
  ],
};

async function main() {
  let failures = 0;
  for (const [category, ids] of Object.entries(FINAL)) {
    for (const id of ids) {
      try {
        const res = await fetch(`https://images.unsplash.com/${id}?w=64&q=30`, {
          method: "GET",
          headers: { Range: "bytes=0-64" },
        });
        const ok = res.status === 200 || res.status === 206;
        if (!ok) failures++;
        console.log(`${ok ? "OK  " : "DEAD"} [${res.status}] ${category.padEnd(9)} ${id}`);
      } catch (error) {
        failures++;
        console.log(`DEAD [ERR] ${category.padEnd(9)} ${id} ${String(error).slice(0, 60)}`);
      }
    }
  }
  console.log(failures === 0 ? "\nALL 28 IMAGE URLS OK" : `\n${failures} FAILURES`);
  process.exit(failures === 0 ? 0 : 1);
}

main();
