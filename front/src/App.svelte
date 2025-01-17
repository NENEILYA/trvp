<script>
  import { onMount } from "svelte";

  // --- Состояние приложения ---
  let mechanics = []; // список всех механиков
  let selectedMechanic = null; // выбранный механик для просмотра задач
  let tasks = []; // задачи выбранного механика
  let brands = []; // список брендов

  // Поля формы для добавления механика
  let mechanicName = "";
  let mechanicBrands = [];
  let mechanicMaxComplexity = 10;

  // Поля формы для добавления задачи
  let taskName = "";
  let taskBrand = "";
  let taskComplexity = 1;

  // Поле для добавления нового бренда
  let newBrand = "";

  // --- Состояние перепривязки задачи ---
  // reassignTaskId: какую задачу сейчас перепривязываем (null, если никакую)
  // reassignMechanicId: какой механик выбран из списка
  let reassignTaskId = null;
  let reassignMechanicId = "";

  // Адрес API вашего сервера
  const API_URL = "http://localhost:3000/api";

  // При монтировании компонента загружаем механиков и бренды
  onMount(async () => {
    await Promise.all([fetchMechanics(), fetchBrands()]);
  });

  // Получаем список механиков
  async function fetchMechanics() {
    const res = await fetch(`${API_URL}/mechanics`);
    mechanics = await res.json();
  }

  // Получаем список брендов
  async function fetchBrands() {
    const res = await fetch(`${API_URL}/brands`);
    brands = await res.json();
  }

  // При клике на механика
  async function selectMechanic(mech) {
    selectedMechanic = mech;
    await fetchTasks(mech.id);
  }

  // Получить задачи выбранного механика
  async function fetchTasks(mechanicId) {
    const res = await fetch(`${API_URL}/mechanics/${mechanicId}/tasks`);
    tasks = await res.json();
  }

  // Добавить механика
  async function addMechanic() {
    if (!mechanicName || mechanicBrands.length === 0) {
      alert("Укажите имя и хотя бы одну марку");
      return;
    }
    try {
      const response = await fetch(`${API_URL}/mechanics`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: mechanicName,
          brands: mechanicBrands,
          maxComplexity: Number(mechanicMaxComplexity),
        }),
      });
      if (!response.ok) {
        const errorData = await response.json();
        alert("Ошибка: " + (errorData.error || "Неизвестная ошибка"));
        return;
      }
      // Если успех
      mechanicName = "";
      mechanicBrands = [];
      mechanicMaxComplexity = 10;
      await fetchMechanics();
    } catch (err) {
      console.error("Ошибка при добавлении механика:", err);
      alert("Не удалось добавить механика.");
    }
  }

  // Удалить механика
  async function deleteMechanic(id) {
    if (!confirm("Точно удалить механика и все его задачи?")) return;
    try {
      const response = await fetch(`${API_URL}/mechanics/${id}`, {
        method: "DELETE",
      });
      if (!response.ok) {
        const errorData = await response.json();
        alert("Ошибка: " + (errorData.error || "Неизвестная ошибка"));
        return;
      }
      // Сбросим выделение
      selectedMechanic = null;
      tasks = [];
      await fetchMechanics();
    } catch (err) {
      console.error("Ошибка при удалении механика:", err);
      alert("Не удалось удалить механика.");
    }
  }

  // Добавить задачу
  async function addTask() {
    if (!selectedMechanic) {
      alert("Сначала выберите механика");
      return;
    }
    try {
      const response = await fetch(
        `${API_URL}/mechanics/${selectedMechanic.id}/tasks`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            brand: taskBrand,
            name: taskName,
            complexity: Number(taskComplexity),
          }),
        },
      );
      if (!response.ok) {
        const errorData = await response.json();
        alert("Ошибка: " + (errorData.error || "Неизвестная ошибка"));
        return;
      }
      // Если ок
      taskName = "";
      taskBrand = "";
      taskComplexity = 1;
      await fetchTasks(selectedMechanic.id);
    } catch (err) {
      console.error("Ошибка при добавлении задачи:", err);
      alert("Не удалось добавить задачу.");
    }
  }

  // Удалить задачу
  async function deleteTask(taskId) {
    if (!selectedMechanic) return;
    if (!confirm("Удалить задачу?")) return;

    try {
      const response = await fetch(
        `${API_URL}/mechanics/${selectedMechanic.id}/tasks/${taskId}`,
        { method: "DELETE" },
      );
      if (!response.ok) {
        const errorData = await response.json();
        alert("Ошибка: " + (errorData.error || "Неизвестная ошибка"));
        return;
      }
      await fetchTasks(selectedMechanic.id);
    } catch (err) {
      console.error("Ошибка при удалении задачи:", err);
      alert("Не удалось удалить задачу.");
    }
  }
  // Функция добавления нового бренда
  async function addNewBrand() {
    if (!newBrand.trim()) return;

    try {
      const response = await fetch(`http://localhost:3000/api/brands`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: newBrand.trim() }),
      });
      if (!response.ok) {
        const errorData = await response.json();
        alert("Ошибка: " + (errorData.error || "Неизвестная ошибка"));
        return;
      }
      // Если всё ок, очищаем поле и обновляем список брендов
      newBrand = "";
      await fetchBrands();
    } catch (err) {
      console.error("Ошибка при добавлении бренда:", err);
      alert("Не удалось добавить бренд.");
    }
  }

  // --- ЛОГИКА ПЕРЕПРИВЯЗКИ (реассоциации) ЗАДАЧИ ---

  // Пользователь нажал «Перепривязать» - показываем форму для этой задачи
  function startReassignTask(taskId) {
    reassignTaskId = taskId;
    reassignMechanicId = "";
  }

  // Отмена перепривязки
  function cancelReassign() {
    reassignTaskId = null;
    reassignMechanicId = "";
  }

  // Подтвердить перепривязку
  async function confirmReassign(task) {
    if (!reassignMechanicId) {
      alert("Выберите механика");
      return;
    }
    try {
      const response = await fetch(`${API_URL}/tasks/${task.id}/reassign`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ newMechanicId: reassignMechanicId }),
      });
      if (!response.ok) {
        const errorData = await response.json();
        alert("Ошибка: " + (errorData.error || "Неизвестная ошибка"));
        return;
      }
      alert("Задача перепривязана!");
      reassignTaskId = null;
      reassignMechanicId = "";
      // Перезагрузим задачи текущего механика (т.к. задача «уехала» другому)
      await fetchTasks(selectedMechanic.id);
    } catch (err) {
      console.error("Ошибка при перепривязке задачи:", err);
      alert("Не удалось перепривязать задачу.");
    }
  }

  // Фильтруем список механиков при перепривязке (например, только те, кто поддерживает текущий brand)
  function mechanicsWhoSupportBrand(brand) {
    return mechanics.filter((m) => m.brands.split(",").includes(brand));
  }

  // Обработчик чекбоксов для выбора марок (механика)
  function toggleMechanicBrand(brandName) {
    if (mechanicBrands.includes(brandName)) {
      mechanicBrands = mechanicBrands.filter((b) => b !== brandName);
    } else {
      mechanicBrands = [...mechanicBrands, brandName];
    }
  }
</script>

<div class="flex gap-8 p-4 min-h-screen">
  <!-- Левый блок: список механиков -->
  <div class="p-4 w-[300px] bg-neutral text-neutral-content rounded-xl">
    <h2 class="text-lg font-semibold mb-2">Механики</h2>

    <div class="flex flex-col overflow-y-auto max-h-1/2 gap-2">
      {#each mechanics as mech}
        <!-- svelte-ignore a11y_no_static_element_interactions -->
        <div
          tabindex="0"
          role="button"
          class="p-2 bg-base-100 rounded-xl cursor-pointer"
          class:bg-base-200={selectedMechanic &&
            selectedMechanic.id === mech.id}
          on:click={() => selectMechanic(mech)}
          on:keydown={(e) => {
            if (e.keyCode == 13) selectMechanic(mech);
          }}
        >
          <strong>{mech.name}</strong>
          <br />
          <span class="text-sm">
            Марки: {mech.brands}
          </span>
          <br />
          <span class="text-sm">
            Лимит: {mech.max_complexity}
          </span>
          <br />
          <div class="flex items-center justify-end">
            <button
              on:click|stopPropagation={() => deleteMechanic(mech.id)}
              class=" btn btn-sm btn-error"
            >
              Удалить
            </button>
          </div>
        </div>
      {/each}
    </div>

    <h3 class="text-md font-semibold mt-4 mb-2">Добавить механика</h3>
    <input
      type="text"
      bind:value={mechanicName}
      placeholder="Имя механика"
      class="w-full mb-2 p-2 rounded-lg"
    />

    <label class="block mb-2">
      <span class="text-sm">Лимит сложности:</span>
      <input
        type="number"
        min="1"
        bind:value={mechanicMaxComplexity}
        class="mt-1 w-full p-2 rounded-lg"
      />
    </label>

    <p class="text-sm mb-1">Выберите марки:</p>

    <div class="flex flex-col gap-2 overflow-y-auto">
      {#each brands as br}
        <label class="block">
          <input
            type="checkbox"
            class="mr-1 checkbox"
            value={br.name}
            checked={mechanicBrands.includes(br.name)}
            on:change={() => toggleMechanicBrand(br.name)}
          />
          {br.name}
        </label>
      {/each}
    </div>

    <div class="flex items-center justify-end">
      <button
        on:click={addMechanic}
        class="mt-2 px-3 py-1 btn btn-primary text-primary-content"
      >
        Сохранить механика
      </button>
    </div>
  </div>

  <!-- Средний блок: задачи выбранного механика -->
  <div class="p-4 flex-1 bg-neutral text-neutral-content rounded-xl">
    {#if selectedMechanic}
      <h2 class="text-lg font-semibold mb-2">
        Задачи механика {selectedMechanic.name}
      </h2>

      {#each tasks as task}
        <div
          class="flex flex-col md:flex-row md:justify-between items-start md:items-center border-b border-gray-200 py-2"
        >
          <div>
            <strong>{task.name}</strong>
            <span class="text-sm ml-2">
              ({task.brand}, сложность {task.complexity})
            </span>
          </div>

          <!-- Если эта задача в режиме перепривязки, показываем форму -->
          {#if reassignTaskId === task.id}
            <div
              class="mt-2 md:mt-0 flex flex-col md:flex-row items-start md:items-center gap-2"
            >
              <!-- Селект: доступные механики, которые обслуживают brand -->
              <select bind:value={reassignMechanicId} class="p-1 select">
                <option disabled selected>Выберете механика</option>
                {#each mechanicsWhoSupportBrand(task.brand) as possibleMech}
                  <!-- Исключим, если это тот же самый механик -->
                  {#if possibleMech.id !== selectedMechanic.id}
                    <option value={possibleMech.id}>
                      {possibleMech.name} (Лимит {possibleMech.max_complexity})
                    </option>
                  {/if}
                {/each}
              </select>

              <button
                class="px-2 py-1 btn btn-success"
                on:click={() => confirmReassign(task)}
              >
                Подтвердить
              </button>
              <button class="px-2 py-1 btn btn-error" on:click={cancelReassign}>
                Отмена
              </button>
            </div>

            <!-- Иначе выводим обычные кнопки: перепривязать, удалить -->
          {:else}
            <div class="mt-2 md:mt-0 flex gap-2">
              <button
                on:click={() => startReassignTask(task.id)}
                class="px-2 py-1 btn btn-accent"
              >
                Перепривязать
              </button>
              <button
                on:click={() => deleteTask(task.id)}
                class="px-2 py-1 btn btn-error"
              >
                Удалить
              </button>
            </div>
          {/if}
        </div>
      {/each}

      <h3 class="text-md font-semibold mt-4 mb-2">Добавить задачу</h3>

      <label class="block mb-2">
        <span class="text-sm">Название:</span>
        <input
          type="text"
          bind:value={taskName}
          class="mt-1 w-full p-2 rounded-lg"
        />
      </label>

      <label class="block mb-2">
        <span class="text-sm">Марка:</span>
        <select bind:value={taskBrand} class="mt-1 p-2 select w-full">
          <option disabled selected>Выберете марку</option>
          {#each brands as br}
            <option value={br.name}>{br.name}</option>
          {/each}
        </select>
      </label>

      <label class="block mb-2">
        <span class="text-sm">Сложность:</span>
        <input
          type="number"
          min="1"
          bind:value={taskComplexity}
          class="mt-1 w-full p-2 rounded-lg"
        />
      </label>

      <div class="flex flex-col justify-end">
        <button on:click={addTask} class="mt-2 px-3 py-1 btn btn-primary">
          Добавить задачу
        </button>
      </div>
    {:else}
      <h2 class="text-lg font-semibold mb-2">
        Выберите механика, чтобы увидеть задачи
      </h2>
    {/if}
  </div>

  <!-- Правый блок: справочник марок -->
  <div class="p-4 w-[300px] bg-neutral text-neutral-content rounded-xl">
    <h2 class="text-lg font-semibold mb-2">Справочник марок</h2>
    {#each brands as br}
      <div class=" py-1">
        {br.name}
      </div>
    {/each}

    <h3 class="text-md font-semibold mt-4 mb-2">Добавить марку</h3>
    <input
      type="text"
      bind:value={newBrand}
      placeholder="Новая марка"
      class="w-full mb-2 p-2 rounded-lg"
    />
    <button on:click={addNewBrand} class="px-3 py-1 btn btn-primary">
      Добавить
    </button>
  </div>
</div>
