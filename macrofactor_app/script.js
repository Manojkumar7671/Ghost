let foodList = [];
let weightList = [];
let dailyExpenditure = 0;

const foodForm = document.getElementById('food-form');
const foodListElement = document.getElementById('food-list');
const weightForm = document.getElementById('weight-form');
const weightChart = document.getElementById('weight-chart');
const dailyExpenditureElement = document.getElementById('daily-expenditure');

foodForm.addEventListener('submit', (e) => {
    e.preventDefault();
    const foodName = document.getElementById('food-name').value;
    const foodCalories = parseInt(document.getElementById('food-calories').value);
    const foodProtein = parseInt(document.getElementById('food-protein').value);
    const foodCarbs = parseInt(document.getElementById('food-carbs').value);
    const foodFat = parseInt(document.getElementById('food-fat').value);
    const food = {
        name: foodName,
        calories: foodCalories,
        protein: foodProtein,
        carbs: foodCarbs,
        fat: foodFat
    };
    foodList.push(food);
    updateFoodList();
    calculateDailyExpenditure();
});

weightForm.addEventListener('submit', (e) => {
    e.preventDefault();
    const weight = parseInt(document.getElementById('weight').value);
    weightList.push(weight);
    updateWeightChart();
});

function updateFoodList() {
    const foodListHtml = foodList.map((food, index) => `
        <li>
            <span>${food.name}</span>
            <span>Calories: ${food.calories}</span>
            <span>Protein: ${food.protein}g</span>
            <span>Carbs: ${food.carbs}g</span>
            <span>Fat: ${food.fat}g</span>
            <button class="remove-btn" data-index="${index}">Remove</button>
        </li>
    `).join('');
    foodListElement.innerHTML = foodListHtml;
    const removeButtons = document.getElementsByClassName('remove-btn');
    Array.from(removeButtons).forEach((button) => {
        button.addEventListener('click', () => {
            const index = button.getAttribute('data-index');
            foodList.splice(index, 1);
            updateFoodList();
            calculateDailyExpenditure();
        });
    });
}

function updateWeightChart() {
    const ctx = weightChart.getContext('2d');
    const chart = new Chart(ctx, {
        type: 'line',
        data: {
            labels: weightList.map((weight, index) => `Day ${index + 1}`),
            datasets: [{
                label: 'Weight',
                data: weightList,
                backgroundColor: 'rgba(255, 99, 132, 0.2)',
                borderColor: 'rgba(255, 99, 132, 1)',
                borderWidth: 1
            }]
        },
        options: {
            scales: {
                yAxes: [{
                    ticks: {
                        beginAtZero: true
                    }
                }]
            }
        }
    });
}

function calculateDailyExpenditure() {
    dailyExpenditure = foodList.reduce((acc, food) => acc + food.calories, 0);
    dailyExpenditureElement.textContent = `Daily Expenditure: ${dailyExpenditure} calories`;
}