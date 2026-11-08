import { DatabaseSync } from "node:sqlite"; import crypto from "node:crypto";
const db = new DatabaseSync("/tmp/gt/gildam.sqlite");
db.prepare("INSERT OR REPLACE INTO admin_sessions (id_hash, sub, role, created_at, expires_at) VALUES (?,?,?,?,?)").run(crypto.createHash("sha256").update("localtest-sid").digest("hex"), "local-test", "admin", Date.now(), Date.now() + 864e5);
console.log("session ok");
