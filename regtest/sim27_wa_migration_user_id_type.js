const assert = require("assert");
const fs = require("fs");
const migration = fs.readFileSync(require.resolve("../nexshop-backend/migrations/018_create_wa_marketing.sql"), "utf8").replace(/\r\n/g, "\n");

assert.match(migration, /user_id BIGINT REFERENCES users\(id\)/);
assert.match(migration, /created_by BIGINT REFERENCES users\(id\)/);
assert.doesNotMatch(migration, /user_id UUID REFERENCES users\(id\)/);
assert.doesNotMatch(migration, /created_by UUID REFERENCES users\(id\)/);

console.log("sim27_wa_migration_user_id_type: passed");
