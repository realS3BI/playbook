import assert from "node:assert/strict";
import test from "node:test";
import { parseMatchShareCode } from "../shared/matches.js";

const code = "CSGO-ABCDE-abcde-23456-fhijk-mnopq";
const link = `steam://rungame/730/76561202255233023/+csgo_download_match%20${code}`;

test("Match inputs extract the sharecode from Steam download links", () => {
  for (const input of [code, `  ${code}\n`, link, ` ${link} `, link.replace("%20", " ")]) {
    assert.equal(parseMatchShareCode(input), code);
  }
});

test("Match inputs reject malformed codes and unrelated Steam commands", () => {
  for (const input of [
    null, undefined, 730, "", "CSGO-xxxxx-xxxxx-xxxxx-xxxxx-xxxxx-extra",
    "CSGO-00000-00000-00000-00000-00000",
    link.replace("/730/", "/440/"),
    link.replace("+csgo_download_match", "+connect"),
    link.replace("steam://", "https://"),
    `${link}%20+quit`, `${link}?extra=true`, `${link}%`,
  ]) {
    assert.equal(parseMatchShareCode(input), null);
  }
});
