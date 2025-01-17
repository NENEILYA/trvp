const express = require('express');
const cors = require('cors');
const { v4: uuidv4 } = require('uuid');
const sqlite3 = require('sqlite3').verbose();
const path = require('path');

const app = express();
app.use(cors());
app.use(express.json());

const DB_PATH = path.join(__dirname, 'autoservice.db');
const db = new sqlite3.Database(DB_PATH);

db.serialize(() => {
	db.run(`
    CREATE TABLE IF NOT EXISTS mechanics (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      brands TEXT NOT NULL,
      max_complexity INTEGER NOT NULL DEFAULT 10
    )
  `);

	db.run(`
    CREATE TABLE IF NOT EXISTS tasks (
      id TEXT PRIMARY KEY,
      mechanic_id TEXT NOT NULL,
      brand TEXT NOT NULL,
      name TEXT NOT NULL,
      complexity INTEGER NOT NULL,
      FOREIGN KEY(mechanic_id) REFERENCES mechanics(id)
    )
  `);

	db.run(`
    CREATE TABLE IF NOT EXISTS brands (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT UNIQUE
    )
  `);

	const insertBrand = db.prepare(`INSERT OR IGNORE INTO brands (name) VALUES (?)`);
	['Audi', 'BMW', 'Toyota', 'Ford'].forEach((brand) => {
		insertBrand.run(brand);
	});
	insertBrand.finalize();
});

app.get('/api/brands', (req, res) => {
	db.all(`SELECT id, name FROM brands`, (err, rows) => {
		if (err) return res.status(500).json({ error: err.message });
		res.json(rows);
	});
});

app.post('/api/brands', (req, res) => {
	const { name } = req.body;
	if (!name) {
		return res.status(400).json({ error: 'Название бренда не указано' });
	}
	const query = `INSERT INTO brands (name) VALUES (?)`;
	db.run(query, [name], function(err) {
		if (err) {
			return res.status(500).json({ error: err.message });
		}
		res.json({ id: this.lastID, name });
	});
});

app.get('/api/mechanics', (req, res) => {
	db.all(`SELECT * FROM mechanics`, (err, rows) => {
		if (err) return res.status(500).json({ error: err.message });
		res.json(rows);
	});
});

app.post('/api/mechanics', (req, res) => {
	const { name, brands, maxComplexity } = req.body;
	if (!name || !brands || !Array.isArray(brands) || brands.length === 0) {
		return res.status(400).json({ error: 'Нужно указать имя и хотя бы одну марку (brands)' });
	}
	const finalMaxComplexity = maxComplexity != null ? maxComplexity : 10;
	const id = uuidv4();
	const query = `
    INSERT INTO mechanics (id, name, brands, max_complexity)
    VALUES (?, ?, ?, ?)
  `;
	db.run(query, [id, name, brands.join(','), finalMaxComplexity], (err) => {
		if (err) {
			return res.status(500).json({ error: err.message });
		}
		res.json({ id, name, brands, max_complexity: finalMaxComplexity });
	});
});

app.put('/api/mechanics/:id', (req, res) => {
	const mechanicId = req.params.id;
	const { name, brands, maxComplexity } = req.body;
	if (!name || !brands || !Array.isArray(brands) || brands.length === 0) {
		return res.status(400).json({ error: 'Нужно указать имя и хотя бы одну марку (brands)' });
	}
	const finalMaxComplexity = maxComplexity != null ? maxComplexity : 10;
	const query = `
    UPDATE mechanics
    SET name=?, brands=?, max_complexity=?
    WHERE id=?
  `;
	db.run(query, [name, brands.join(','), finalMaxComplexity, mechanicId], function(err) {
		if (err) {
			return res.status(500).json({ error: err.message });
		}
		if (this.changes === 0) {
			return res.status(404).json({ error: 'Механик не найден' });
		}
		res.json({ message: 'Механик обновлён' });
	});
});

app.delete('/api/mechanics/:id', (req, res) => {
	const mechanicId = req.params.id;
	db.run(`DELETE FROM tasks WHERE mechanic_id=?`, [mechanicId], function(err) {
		if (err) return res.status(500).json({ error: err.message });
		db.run(`DELETE FROM mechanics WHERE id=?`, [mechanicId], function(err2) {
			if (err2) return res.status(500).json({ error: err2.message });
			if (this.changes === 0) {
				return res.status(404).json({ error: 'Механик не найден' });
			}
			res.json({ message: 'Механик и все его задачи удалены' });
		});
	});
});

app.get('/api/mechanics/:id/tasks', (req, res) => {
	const mechanicId = req.params.id;
	db.all(`SELECT * FROM tasks WHERE mechanic_id=?`, [mechanicId], (err, rows) => {
		if (err) return res.status(500).json({ error: err.message });
		res.json(rows);
	});
});

function checkMechanicCanTakeTask(db, mechanicId, brand, complexity, callback) {
	db.get(`SELECT brands, max_complexity FROM mechanics WHERE id=?`, [mechanicId], (err, mechanicRow) => {
		if (err) return callback(err);
		if (!mechanicRow) {
			return callback({ message: 'Механик не найден', code: 404 });
		}
		const mechanicBrands = mechanicRow.brands.split(',');
		if (!mechanicBrands.includes(brand)) {
			return callback({ message: `Механик не обслуживает марку «${brand}». Допустимые: ${mechanicRow.brands}`, code: 400 });
		}
		db.get(`SELECT SUM(complexity) AS total_complexity FROM tasks WHERE mechanic_id=?`, [mechanicId], (err2, sumRow) => {
			if (err2) return callback(err2);
			const currentSum = sumRow.total_complexity || 0;
			const newSum = currentSum + complexity;
			const limit = mechanicRow.max_complexity;
			if (newSum > limit) {
				return callback({ message: `Суммарная сложность (${newSum}) превышает лимит (${limit}) у механика`, code: 400 });
			}
			callback(null);
		});
	});
}

app.post('/api/mechanics/:id/tasks', (req, res) => {
	const mechanicId = req.params.id;
	const { brand, name, complexity } = req.body;
	if (!brand || !name || complexity == null) {
		return res.status(400).json({ error: 'Нужно указать brand, name, complexity' });
	}
	checkMechanicCanTakeTask(db, mechanicId, brand, complexity, (checkErr) => {
		if (checkErr) {
			if (checkErr.code) {
				return res.status(checkErr.code).json({ error: checkErr.message });
			}
			return res.status(500).json({ error: checkErr.message });
		}
		const taskId = uuidv4();
		const query = `
      INSERT INTO tasks (id, mechanic_id, brand, name, complexity)
      VALUES (?, ?, ?, ?, ?)
    `;
		db.run(query, [taskId, mechanicId, brand, name, complexity], function(err3) {
			if (err3) {
				return res.status(500).json({ error: err3.message });
			}
			res.json({ id: taskId, mechanic_id: mechanicId, brand, name, complexity });
		});
	});
});

app.put('/api/mechanics/:id/tasks/:taskId', (req, res) => {
	const mechanicId = req.params.id;
	const { taskId } = req.params;
	const { brand, name, complexity } = req.body;
	if (!brand || !name || complexity == null) {
		return res.status(400).json({ error: 'Нужно указать brand, name, complexity' });
	}
	const query = `
    UPDATE tasks
    SET brand=?, name=?, complexity=?
    WHERE id=? AND mechanic_id=?
  `;
	db.run(query, [brand, name, complexity, taskId, mechanicId], function(err) {
		if (err) return res.status(500).json({ error: err.message });
		if (this.changes === 0) {
			return res.status(404).json({ error: 'Задача не найдена или принадлежит другому механику' });
		}
		res.json({ message: 'Задача обновлена' });
	});
});

app.delete('/api/mechanics/:id/tasks/:taskId', (req, res) => {
	const mechanicId = req.params.id;
	const { taskId } = req.params;
	const query = `DELETE FROM tasks WHERE id=? AND mechanic_id=?`;
	db.run(query, [taskId, mechanicId], function(err) {
		if (err) return res.status(500).json({ error: err.message });
		if (this.changes === 0) {
			return res.status(404).json({ error: 'Задача не найдена или принадлежит другому механику' });
		}
		res.json({ message: 'Задача удалена' });
	});
});

app.put('/api/tasks/:taskId/reassign', (req, res) => {
	const { taskId } = req.params;
	const { newMechanicId } = req.body;
	if (!newMechanicId) {
		return res.status(400).json({ error: 'newMechanicId is required' });
	}
	db.get(`SELECT brand, complexity FROM tasks WHERE id=?`, [taskId], (err, taskRow) => {
		if (err) {
			return res.status(500).json({ error: err.message });
		}
		if (!taskRow) {
			return res.status(404).json({ error: 'Задача не найдена' });
		}
		const { brand, complexity } = taskRow;
		checkMechanicCanTakeTask(db, newMechanicId, brand, complexity, (checkErr) => {
			if (checkErr) {
				if (checkErr.code) {
					return res.status(checkErr.code).json({ error: checkErr.message });
				}
				return res.status(500).json({ error: checkErr.message });
			}
			db.run(`UPDATE tasks SET mechanic_id=? WHERE id=?`, [newMechanicId, taskId], function(err2) {
				if (err2) {
					return res.status(500).json({ error: err2.message });
				}
				if (this.changes === 0) {
					return res.status(404).json({ error: 'Задача не найдена (или не обновлена)' });
				}
				res.json({ message: 'Задача переназначена другому механику' });
			});
		});
	});
});

const PORT = 3000;
app.listen(PORT, () => {
	console.log(`Сервер запущен на http://localhost:${PORT}`);
});
