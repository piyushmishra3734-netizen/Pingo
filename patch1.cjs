const fs = require("node:fs");
function patch(file, from, to) {
  const p = file;
  let s = fs.readFileSync(p, "utf8");
  if (!s.includes(from)) { console.log("MISS", file); return; }
  fs.writeFileSync(p, s.replace(from, to));
  console.log("ok  ", file);
}
patch(
  "supabase/functions/tmdb/index.ts",
  "(\\/(videos|credits|similar|recommendations))?",
  "(\\/(videos|credits|similar|recommendations|external_ids))?",
);
patch(
  "apps/web/src/features/tv/api/tmdb.ts",
  "append_to_response: 'videos,credits,similar',",
  "append_to_response: 'videos,credits,similar,external_ids',",
);
