const fs = require("fs");
const path = require("path");

const dbFile = path.join(__dirname, "db_data.json");
const initialData = {
  users: [],
  notes: []
};

fs.writeFileSync(dbFile, JSON.stringify(initialData, null, 2));
console.log("[Migration] Migration complete: JSON-backed database initialized with users and notes tables.");
