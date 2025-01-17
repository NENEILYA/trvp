const express = require('express');
const cors = require('cors');
const { v4: uuidv4 } = require('uuid');
const sqlite3 = require('sqlite3').verbose();
const path = require('path');

// Инициализируем приложение
const app = express();
app.use(cors());
app.use(express.json());

// Путь к файлу БД
const DB_PATH = path.join(__dirname, 'autoservice.db');
const db = new sqlite3.Database(DB_PATH);

// Создаём таблицы (при первом запуске)
db.serialize(() => {
	// Таблица механиков
	db.run(`
    CREATE TABLE IF NOT EXISTS mechanics (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      brands TEXT NOT NULL,
      max_complexity INTEGER NOT NULL DEFAULT 10
    )
  `);

	// Таблица задач
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

	// Таблица брендов
	db.run(`
    CREATE TABLE IF NOT EXISTS brands (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT UNIQUE
    )
  `);

	// Вставим несколько брендов по умолчанию, если их нет
	const insertBrand = db.prepare(
		`INSERT OR IGNORE INTO brands (name) VALUES (?)`
	);
	['Audi', 'BMW', 'Toyota', 'Ford'].forEach((brand) => {
		insertBrand.run(brand);
	});
	insertBrand.finalize();
});

/* =====================
   БРЕНДЫ
   ===================== */

// Получить все бренды
app.get('/api/brands', (req, res) => {
	db.all(`SELECT id, name FROM brands`, (err, rows) => {
		if (err) return res.status(500).json({ error: err.message });
		res.json(rows);
	});
});

// Добавить новый бренд
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

/* =====================
   МЕХАНИКИ
   ===================== */

// Получить список механиков
app.get('/api/mechanics', (req, res) => {
	db.all(`SELECT * FROM mechanics`, (err, rows) => {
		if (err) return res.status(500).json({ error: err.message });
		res.json(rows);
	});
});

// Добавить механика
app.post('/api/mechanics', (req, res) => {
	const { name, brands, maxComplexity } = req.body;
	if (!name || !brands || !Array.isArray(brands) || brands.length === 0) {
		return res
			.status(400)
			.json({ error: 'Нужно указать имя и хотя бы одну марку (brands)' });
	}
	// По умолчанию, если maxComplexity не пришёл, пусть будет 10
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

// Обновить информацию о механике (включая maxComplexity)
app.put('/api/mechanics/:id', (req, res) => {
	const mechanicId = req.params.id;
	const { name, brands, maxComplexity } = req.body;

	if (!name || !brands || !Array.isArray(brands) || brands.length === 0) {
		return res
			.status(400)
			.json({ error: 'Нужно указать имя и хотя бы одну марку (brands)' });
	}
	const finalMaxComplexity = maxComplexity != null ? maxComplexity : 10;

	const query = `
    UPDATE mechanics
    SET name=?, brands=?, max_complexity=?
    WHERE id=?
  `;
	db.run(
		query,
		[name, brands.join(','), finalMaxComplexity, mechanicId],
		function(err) {
			if (err) {
				return res.status(500).json({ error: err.message });
			}
			if (this.changes === 0) {
				return res.status(404).json({ error: 'Механик не найден' });
			}
			res.json({ message: 'Механик обновлён' });
		}
	);
});

// Удалить механика
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

/* =====================
   ЗАДАНИЯ (ТО)
   ===================== */

// Получить все задачи механика
app.get('/api/mechanics/:id/tasks', (req, res) => {
	const mechanicId = req.params.id;
	db.all(`SELECT * FROM tasks WHERE mechanic_id=?`, [mechanicId], (err, rows) => {
		if (err) return res.status(500).json({ error: err.message });
		res.json(rows);
	});
});

// Вспомогательная функция проверки: «Механик обслуживает марку и не превышен лимит?»
function checkMechanicCanTakeTask(db, mechanicId, brand, complexity, callback) {
	// 1. Получаем механика
	db.get(
		`SELECT brands, max_complexity FROM mechanics WHERE id=?`,
		[mechanicId],
		(err, mechanicRow) => {
			if (err) return callback(err);
			if (!mechanicRow) {
				return callback({ message: 'Механик не найден', code: 404 });
			}

			// Проверка бренда
			const mechanicBrands = mechanicRow.brands.split(',');
			if (!mechanicBrands.includes(brand)) {
				return callback({
					message: `Механик не обслуживает марку «${brand}». Допустимые: ${mechanicRow.brands}`,
					code: 400
				});
			}

			// 2. Суммарная сложность
			db.get(
				`SELECT SUM(complexity) AS total_complexity
         FROM tasks
         WHERE mechanic_id=?`,
				[mechanicId],
				(err2, sumRow) => {
					if (err2) return callback(err2);

					const currentSum = sumRow.total_complexity || 0;
					const newSum = currentSum + complexity;

					// Лимит у конкретного механика
					const limit = mechanicRow.max_complexity;
					if (newSum > limit) {
						return callback({
							message: `Суммарная сложность (${newSum}) превышает лимит (${limit}) у механика`,
							code: 400
						});
					}

					// Если всё ок — возвращаем callback(null) без ошибки
					callback(null);
				}
			);
		}
	);
}

// Добавить новую задачу
app.post('/api/mechanics/:id/tasks', (req, res) => {
	const mechanicId = req.params.id;
	const { brand, name, complexity } = req.body;

	if (!brand || !name || complexity == null) {
		return res
			.status(400)
			.json({ error: 'Нужно указать brand, name, complexity' });
	}

	// Проверяем, может ли этот механик взять задачу
	checkMechanicCanTakeTask(db, mechanicId, brand, complexity, (checkErr) => {
		if (checkErr) {
			// Если checkErr — это "объект" с полем code, значит это наша проверка
			if (checkErr.code) {
				return res.status(checkErr.code).json({ error: checkErr.message });
			}
			// Иначе это DB-ошибка
			return res.status(500).json({ error: checkErr.message });
		}

		// Если всё ок, добавляем задачу
		const taskId = uuidv4();
		const query = `
      INSERT INTO tasks (id, mechanic_id, brand, name, complexity)
      VALUES (?, ?, ?, ?, ?)
    `;
		db.run(
			query,
			[taskId, mechanicId, brand, name, complexity],
			function(err3) {
				if (err3) {
					return res.status(500).json({ error: err3.message });
				}
				res.json({
					id: taskId,
					mechanic_id: mechanicId,
					brand,
					name,
					complexity
				});
			}
		);
	});
});

// Обновить задачу (без проверки лимита/бренда, при желании можно добавить)
app.put('/api/mechanics/:id/tasks/:taskId', (req, res) => {
	const mechanicId = req.params.id;
	const { taskId } = req.params;
	const { brand, name, complexity } = req.body;

	if (!brand || !name || complexity == null) {
		return res
			.status(400)
			.json({ error: 'Нужно указать brand, name, complexity' });
	}

	// Если хотим также проверить, что бренд и лимит подходят этому механику,
	// можем вызвать checkMechanicCanTakeTask. Для краткости — опустим.

	const query = `
    UPDATE tasks
    SET brand=?, name=?, complexity=?
    WHERE id=? AND mechanic_id=?
  `;
	db.run(query, [brand, name, complexity, taskId, mechanicId], function(err) {
		if (err) return res.status(500).json({ error: err.message });
		if (this.changes === 0) {
			return res
				.status(404)
				.json({ error: 'Задача не найдена или принадлежит другому механику' });
		}
		res.json({ message: 'Задача обновлена' });
	});
});

// Удалить задачу
app.delete('/api/mechanics/:id/tasks/:taskId', (req, res) => {
	const mechanicId = req.params.id;
	const { taskId } = req.params;

	const query = `DELETE FROM tasks WHERE id=? AND mechanic_id=?`;
	db.run(query, [taskId, mechanicId], function(err) {
		if (err) return res.status(500).json({ error: err.message });
		if (this.changes === 0) {
			return res
				.status(404)
				.json({ error: 'Задача не найдена или принадлежит другому механику' });
		}
		res.json({ message: 'Задача удалена' });
	});
});

/* =====================
   ПЕРЕНАЗНАЧЕНИЕ (реассоциация) ЗАДАЧИ
   ===================== */

/**
 * Маршрут для перепривязки (переназначения) задачи другому механику.
 *
 *  PUT /api/tasks/:taskId/reassign
 *  Body: { newMechanicId: '...' }
 */
app.put('/api/tasks/:taskId/reassign', (req, res) => {
	const { taskId } = req.params;
	const { newMechanicId } = req.body;
	if (!newMechanicId) {
		return res.status(400).json({ error: 'newMechanicId is required' });
	}

	// 1. Получаем текущую задачу, чтобы узнать её brand, complexity.
	db.get(
		`SELECT brand, complexity FROM tasks WHERE id=?`,
		[taskId],
		(err, taskRow) => {
			if (err) {
				return res.status(500).json({ error: err.message });
			}
			if (!taskRow) {
				return res.status(404).json({ error: 'Задача не найдена' });
			}

			const { brand, complexity } = taskRow;

			// 2. Проверим, может ли новый механик взять задачу
			checkMechanicCanTakeTask(db, newMechanicId, brand, complexity, (checkErr) => {
				if (checkErr) {
					if (checkErr.code) {
						return res.status(checkErr.code).json({ error: checkErr.message });
					}
					return res.status(500).json({ error: checkErr.message });
				}

				// 3. Если всё ок — обновляем mechanic_id у задачи
				db.run(
					`UPDATE tasks SET mechanic_id=? WHERE id=?`,
					[newMechanicId, taskId],
					function(err2) {
						if (err2) {
							return res.status(500).json({ error: err2.message });
						}
						if (this.changes === 0) {
							return res
								.status(404)
								.json({ error: 'Задача не найдена (или не обновлена)' });
						}
						res.json({ message: 'Задача переназначена другому механику' });
					}
				);
			});
		}
	);
});

/* =====================
   Запуск сервера
   ===================== */

const PORT = 3000;
app.listen(PORT, () => {
	console.log(`Сервер запущен на http://localhost:${PORT}`);
});
