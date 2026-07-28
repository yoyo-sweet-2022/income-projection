// ============================================================
// 收入规划模拟器 - 核心脚本
// ============================================================

(function () {
  'use strict';

  // ============================================================
  // SECTION 1: Defaults & State
  // ============================================================

  const DEFAULTS = {
    basic: {
      currentAge: 30,
      spouseAge: 30,
      retirementAge: 60,
      lifeExpectancy: 85,
    },
    economy: {
      inflationRate: 3.0,
      preRetireReturn: 5.0,
      postRetireReturn: 3.0,
      salaryGrowthRate: 5.0,
      taxRate: 10.0,
      taxAllowance: 60000,
    },
    assets: {
      cash: 100000,
      investments: 200000,
      houseEquity: 0,
      otherAssets: 0,
    },
    expenses: {
      living: 3000,
      utilities: 500,
      communication: 300,
      transportation: 1000,
      rent: 0,
      insurance: 800,
      medical: 300,
      entertainment: 1000,
      petCare: 0,
      miscellaneous: 500,
    },
    social: {
      monthlyGatherings: 500,
      annualSpecial: 5000,
    },
    target: {
      targetSavings: 2000000,
    },
    income: {
      monthlySalary: 15000,
      otherMonthlyIncome: 0,
      monthlyPension: 3000,
    },
  };

  // Default children and liabilities are handled via DOM templates

  // Global state
  let state = {
    mode: 'goal-seeking', // 'goal-seeking' | 'projection'
    view: 'nominal',      // 'nominal' | 'real'
    yearlyData: [],
    summary: {
      requiredMonthlyIncome: null,
      retirementSavings: 0,
      retirementMonthlyExpenses: 0,
      sustainabilityAge: null,
      totalLifetimeExpenses: 0,
      totalLifetimeIncome: 0,
    },
  };

  // Chart.js instances
  let charts = {
    savings: null,
    cashflow: null,
    breakdown: null,
    sensitivity: null,
  };

  // ============================================================
  // SECTION 2: Utility Functions
  // ============================================================

  /** Format number as Chinese currency */
  function formatCNY(amount) {
    if (amount === null || amount === undefined || isNaN(amount)) return '—';
    const abs = Math.abs(amount);
    let formatted;
    if (abs >= 1e8) {
      formatted = (amount / 1e8).toFixed(2) + '亿';
    } else if (abs >= 1e4) {
      formatted = (amount / 1e4).toFixed(1) + '万';
    } else {
      formatted = Math.round(amount).toLocaleString('zh-CN');
    }
    return formatted;
  }

  /** Format number with exact thousand separators */
  function formatExact(amount) {
    if (amount === null || amount === undefined || isNaN(amount)) return '—';
    return Math.round(amount).toLocaleString('zh-CN');
  }

  /** Round to 2 decimal places */
  function round2(val) {
    return Math.round(val * 100) / 100;
  }

  /** Clamp a number */
  function clamp(val, min, max) {
    return Math.min(Math.max(val, min), max);
  }

  // ============================================================
  // SECTION 3: Calculator Engine
  // ============================================================

  const Calculator = {
    /**
     * Run a full year-by-year simulation.
     * @param {Object} params - Full parameter object from form
     * @param {number} [monthlySalaryOverride] - Override monthly salary for goal-seeking
     * @returns {Array} yearlyData array
     */
    simulate: function (params, monthlySalaryOverride) {
      const p = JSON.parse(JSON.stringify(params));
      if (monthlySalaryOverride !== undefined) {
        p.income.monthlySalary = monthlySalaryOverride;
      }

      const {
        basic, economy, assets, liabilities, expenses,
        children, social, income, target,
      } = p;

      const startAge = basic.currentAge;
      const retirementAge = basic.retirementAge;
      const lifeExpectancy = basic.lifeExpectancy;
      const totalYears = Math.max(1, lifeExpectancy - startAge);

      const inflation = economy.inflationRate / 100;
      const preReturn = economy.preRetireReturn / 100;
      const postReturn = economy.postRetireReturn / 100;
      const salaryGrowth = economy.salaryGrowthRate / 100;
      const taxRate = economy.taxRate / 100;
      const taxAllowance = economy.taxAllowance;

      let savings = (assets.cash || 0) + (assets.investments || 0) + (assets.otherAssets || 0);
      const yearlyData = [];
      const startYear = new Date().getFullYear();
      let hasDepleted = false;

      for (let t = 0; t <= totalYears; t++) {
        const age = startAge + t;
        const isRetired = age >= retirementAge;

        // Inflation / growth factors
        const inflFactor = Math.pow(1 + inflation, t);
        const salaryFactor = Math.pow(1 + salaryGrowth, t);

        // --- Income ---
        const salaryIncome = !isRetired ? (income.monthlySalary || 0) * 12 * salaryFactor : 0;
        const otherIncome = (income.otherMonthlyIncome || 0) * 12 * inflFactor;
        const pensionIncome = isRetired ? (income.monthlyPension || 0) * 12 * inflFactor : 0;
        const totalIncome = salaryIncome + otherIncome + pensionIncome;

        // --- Expenses ---
        const baseMonthlyExpenses =
          (expenses.living || 0) + (expenses.utilities || 0) + (expenses.communication || 0) +
          (expenses.transportation || 0) + (expenses.rent || 0) + (expenses.insurance || 0) +
          (expenses.medical || 0) + (expenses.entertainment || 0) + (expenses.petCare || 0) +
          (expenses.miscellaneous || 0);
        const baseLivingExpenses = baseMonthlyExpenses * 12 * inflFactor;

        // Social expenses
        const socialExpenses = ((social.monthlyGatherings || 0) * 12 + (social.annualSpecial || 0)) * inflFactor;

        // Children expenses
        let childExpenses = 0;
        let childEducationFund = 0;
        if (children && children.length > 0) {
          for (const child of children) {
            const indepAge = child.independenceAge || 22;
            if (age < indepAge) {
              childExpenses += (child.monthlyAllowance || 0) * 12 * inflFactor;
              childExpenses += (child.annualEducation || 0) * inflFactor;
              childExpenses += (child.extracurricular || 0) * inflFactor;

              // College fund: annual contribution
              const collegeTarget = child.collegeFund || 0;
              if (collegeTarget > 0 && age >= 18 && age < indepAge) {
                const remaining = indepAge - age;
                if (remaining > 0) {
                  childEducationFund += collegeTarget / remaining;
                }
              }
            }
          }
        }

        // Liability payments (fixed nominal amounts, NOT inflation-adjusted)
        let liabilityPayments = 0;
        if (liabilities && liabilities.length > 0) {
          for (const liability of liabilities) {
            const remaining = liability.remainingYears || 0;
            if (t < remaining) {
              liabilityPayments += (liability.monthlyPayment || 0) * 12;
            }
          }
        }

        const totalExpenses = baseLivingExpenses + socialExpenses + childExpenses + childEducationFund + liabilityPayments;

        // --- Tax (simplified: only on salary income above allowance) ---
        const taxableIncome = Math.max(0, salaryIncome - taxAllowance);
        const tax = taxableIncome * taxRate;

        // --- Net Cash Flow ---
        const netCashFlow = totalIncome - totalExpenses - tax;

        // --- Savings at end of year ---
        const returnRate = isRetired ? postReturn : preReturn;
        let prevSavings = savings;
        if (!hasDepleted) {
          savings = Math.max(0, (prevSavings + netCashFlow) * (1 + returnRate));
        } else {
          savings = 0; // Once depleted, stays at 0
        }

        const isDepleted = !hasDepleted && savings <= 0 && isRetired && t > 0;
        if (isDepleted) hasDepleted = true;

        yearlyData.push({
          yearIndex: t,
          year: startYear + t,
          age: age,
          isRetired: isRetired,
          isDepleted: hasDepleted,
          salaryIncome: round2(salaryIncome),
          otherIncome: round2(otherIncome),
          pensionIncome: round2(pensionIncome),
          totalIncome: round2(totalIncome),
          baseLivingExpenses: round2(baseLivingExpenses),
          socialExpenses: round2(socialExpenses),
          childExpenses: round2(childExpenses),
          childEducationFund: round2(childEducationFund),
          liabilityPayments: round2(liabilityPayments),
          tax: round2(tax),
          totalExpenses: round2(totalExpenses),
          netCashFlow: round2(netCashFlow),
          savings: round2(savings),
          // Real (today's value)
          totalIncomeReal: round2(totalIncome / inflFactor),
          totalExpensesReal: round2(totalExpenses / inflFactor),
          savingsReal: round2(savings / inflFactor),
        });
      }

      return yearlyData;
    },

    /**
     * Binary search to find required monthly income to hit target savings.
     * @param {Object} params
     * @returns {{ requiredIncome: number|null, data: Array, achievable: boolean, error?: string }}
     */
    findRequiredMonthlyIncome: function (params) {
      const targetSavings = params.target.targetSavings;
      const lowBound = 0;
      const highBound = 10000000; // 1000万/月 — upper bound
      const tolerance = 1000; // acceptable error
      const maxIterations = 60;

      // Quick check: even at max income, can we reach target?
      const testDataHigh = this.simulate(params, highBound);
      const finalAtHigh = testDataHigh[testDataHigh.length - 1].savings;
      if (finalAtHigh < targetSavings) {
        return {
          requiredIncome: null,
          data: testDataHigh,
          achievable: false,
          error: '即使在月收入1000万的情况下也无法达到目标存款。请降低目标或调整参数。',
        };
      }

      // Check at low bound (income = 0)
      const testDataLow = this.simulate(params, lowBound);
      const finalAtLow = testDataLow[testDataLow.length - 1].savings;
      if (finalAtLow >= targetSavings) {
        return {
          requiredIncome: 0,
          data: testDataLow,
          achievable: true,
        };
      }

      // Binary search
      let low = 0;
      let high = highBound;
      let bestData = null;

      for (let i = 0; i < maxIterations; i++) {
        const mid = (low + high) / 2;
        const data = this.simulate(params, mid);
        const finalSavings = data[data.length - 1].savings;

        if (Math.abs(finalSavings - targetSavings) < tolerance) {
          return { requiredIncome: round2(mid), data, achievable: true };
        }

        if (finalSavings < targetSavings) {
          low = mid;
        } else {
          high = mid;
          bestData = data;
        }
      }

      const bestMid = round2((low + high) / 2);
      bestData = this.simulate(params, bestMid);
      return { requiredIncome: bestMid, data: bestData, achievable: true };
    },

    /**
     * Project retirement based on current salary.
     * @param {Object} params
     * @returns {{ data: Array, retirementSavings: number }}
     */
    project: function (params) {
      const data = this.simulate(params);
      const finalSavings = data[data.length - 1].savings;
      return { data, retirementSavings: finalSavings };
    },
  };

  // ============================================================
  // SECTION 4: Form Data Collection
  // ============================================================

  /**
   * Collect all form data into a structured object.
   */
  function collectFormData() {
    const data = JSON.parse(JSON.stringify(DEFAULTS));

    // Read simple fields via data-key attribute
    const allInputs = document.querySelectorAll('[data-key]');
    allInputs.forEach(function (input) {
      const key = input.getAttribute('data-key');
      const parts = key.split('.');
      let val = parseFloat(input.value);
      if (isNaN(val)) {
        // Try text
        val = input.value;
      }

      // Navigate to the right nesting level
      let obj = data;
      for (let i = 0; i < parts.length - 1; i++) {
        if (!obj[parts[i]]) obj[parts[i]] = {};
        obj = obj[parts[i]];
      }
      obj[parts[parts.length - 1]] = val;
    });

    // Collect dynamic liabilities from DOM
    data.liabilities = [];
    const liabilityBlocks = document.querySelectorAll('#liabilityList .dynamic-block');
    liabilityBlocks.forEach(function (block) {
      const inputs = block.querySelectorAll('[data-key]');
      const item = {};
      inputs.forEach(function (inp) {
        const key = inp.getAttribute('data-key').split('.').slice(1).join('.');
        let val = parseFloat(inp.value);
        if (isNaN(val)) val = inp.value;
        item[key] = val;
      });
      // Ensure numeric fields
      item.total = parseFloat(item.total) || 0;
      item.monthlyPayment = parseFloat(item.monthlyPayment) || 0;
      item.remainingYears = parseFloat(item.remainingYears) || 0;
      data.liabilities.push(item);
    });

    // Collect dynamic children from DOM
    data.children = [];
    const childBlocks = document.querySelectorAll('#childList .dynamic-block');
    childBlocks.forEach(function (block) {
      const inputs = block.querySelectorAll('[data-key]');
      const item = {};
      inputs.forEach(function (inp) {
        const key = inp.getAttribute('data-key').split('.').slice(1).join('.');
        let val = parseFloat(inp.value);
        if (isNaN(val)) val = inp.value;
        item[key] = val;
      });
      // Ensure numeric fields
      item.age = parseInt(item.age) || 0;
      item.monthlyAllowance = parseFloat(item.monthlyAllowance) || 0;
      item.annualEducation = parseFloat(item.annualEducation) || 0;
      item.extracurricular = parseFloat(item.extracurricular) || 0;
      item.collegeFund = parseFloat(item.collegeFund) || 0;
      item.independenceAge = parseInt(item.independenceAge) || 22;
      data.children.push(item);
    });

    return data;
  }

  // ============================================================
  // SECTION 5: Result Analysis
  // ============================================================

  /**
   * Analyze yearly data to produce summary metrics.
   */
  function analyzeResults(yearlyData, params) {
    if (!yearlyData || yearlyData.length === 0) {
      return state.summary;
    }

    const retirementAge = params.basic.retirementAge;

    // Find retirement year data
    const retirementRecord = yearlyData.find(function (d) { return d.age === retirementAge; })
      || yearlyData[Math.min(yearlyData.length - 1, Math.max(0, retirementAge - params.basic.currentAge))];

    // Find last non-depleted record for sustainability
    let sustainabilityRecord = null;
    let sustainabilityAge = null;
    for (let i = yearlyData.length - 1; i >= 0; i--) {
      if (yearlyData[i].savings > 0) {
        sustainabilityRecord = yearlyData[i];
        sustainabilityAge = yearlyData[i].age;
        break;
      }
    }

    // If savings never depleted, find the last record
    if (!sustainabilityRecord) {
      sustainabilityRecord = yearlyData[yearlyData.length - 1];
      sustainabilityAge = yearlyData[yearlyData.length - 1].age;
    }

    // Total lifetime income and expenses
    const totalLifetimeIncome = yearlyData.reduce(function (sum, d) { return sum + d.totalIncome; }, 0);
    const totalLifetimeExpenses = yearlyData.reduce(function (sum, d) { return sum + d.totalExpenses + d.tax; }, 0);

    // Is sustainability to life expectancy?
    const isSustainable = sustainabilityAge >= params.basic.lifeExpectancy;

    state.summary = {
      requiredMonthlyIncome: state.mode === 'goal-seeking' ? state.lastRequiredIncome : params.income.monthlySalary,
      retirementSavings: retirementRecord ? retirementRecord.savings : 0,
      retirementMonthlyExpenses: retirementRecord
        ? (retirementRecord.totalExpenses / 12) : 0,
      sustainabilityAge: sustainabilityAge,
      isSustainable: isSustainable,
      totalLifetimeIncome: totalLifetimeIncome,
      totalLifetimeExpenses: totalLifetimeExpenses,
      retirementYear: retirementRecord ? retirementRecord.year : null,
      finalSavings: yearlyData[yearlyData.length - 1].savings,
    };

    return state.summary;
  }

  // ============================================================
  // SECTION 6: UI Rendering
  // ============================================================

  /** Update summary cards */
  function renderSummaryCards(summary) {
    const s = summary || state.summary;
    const isGoal = state.mode === 'goal-seeking';

    document.getElementById('cardRequiredIncome').textContent =
      s.requiredMonthlyIncome ? '¥' + formatExact(s.requiredMonthlyIncome) + '/月' : '—';

    document.getElementById('cardRetirementSavings').textContent =
      '¥' + formatCNY(s.retirementSavings);

    document.getElementById('cardRetirementExpenses').textContent =
      '¥' + formatExact(s.retirementMonthlyExpenses) + '/月';

    const sustainEl = document.getElementById('cardSustainability');
    if (s.isSustainable) {
      sustainEl.textContent = '终身充足 ✅';
      sustainEl.style.color = 'var(--color-success)';
    } else if (s.sustainabilityAge) {
      sustainEl.textContent = s.sustainabilityAge + '岁';
      sustainEl.style.color = 'var(--color-warning)';
    } else {
      sustainEl.textContent = '—';
    }
  }

  /** Render the yearly data table */
  function renderDataTable(yearlyData, params) {
    const tbody = document.getElementById('tableBody');
    if (!yearlyData || yearlyData.length === 0) {
      tbody.innerHTML = '<tr><td colspan="9" class="table-empty">请点击"开始计算"查看结果</td></tr>';
      return;
    }

    const isReal = state.view === 'real';
    const retirementAge = params ? params.basic.retirementAge : 60;

    let html = '';
    yearlyData.forEach(function (d) {
      const income = isReal ? d.totalIncomeReal : d.totalIncome;
      const expenses = isReal ? d.totalExpensesReal : d.totalExpenses;
      const savings = isReal ? d.savingsReal : d.savings;

      let rowClass = '';
      let statusText = '';
      let statusClass = '';

      if (d.isDepleted) {
        rowClass = 'depleted-row';
        statusText = '⚠ 耗尽';
        statusClass = 'status-badge depleted';
      } else if (d.isRetired) {
        statusText = '🏖 退休';
        statusClass = 'status-badge retired';
      } else {
        statusText = '💼 工作';
        statusClass = 'status-badge working';
      }

      if (d.age === retirementAge && !d.isDepleted) {
        rowClass = 'retirement-row';
      }

      html += '<tr class="' + rowClass + '">'
        + '<td>' + d.year + '</td>'
        + '<td>' + d.age + '</td>'
        + '<td>' + formatExact(income) + '</td>'
        + '<td>' + formatExact(expenses) + '</td>'
        + '<td>' + formatExact(d.liabilityPayments || 0) + '</td>'
        + '<td>' + formatExact(d.tax || 0) + '</td>'
        + '<td>' + formatExact(d.netCashFlow) + '</td>'
        + '<td>' + formatExact(savings) + '</td>'
        + '<td><span class="' + statusClass + '">' + statusText + '</span></td>'
        + '</tr>';
    });

    tbody.innerHTML = html;
  }

  // ============================================================
  // SECTION 7: Charts
  // ============================================================

  const CHART_COLORS = [
    '#2563eb', '#10b981', '#f59e0b', '#ef4444',
    '#8b5cf6', '#ec4899', '#14b8a6', '#f97316',
  ];

  /** Initialize chart instances */
  function initCharts() {
    const commonOpts = {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: {
          labels: { font: { size: 11, family: getComputedStyle(document.body).fontFamily } },
        },
      },
    };

    // Chart 1: Savings Growth
    const ctx1 = document.getElementById('chartSavings').getContext('2d');
    charts.savings = new Chart(ctx1, {
      type: 'line',
      data: {
        labels: [],
        datasets: [
          { label: '总储蓄', data: [], borderColor: CHART_COLORS[0], backgroundColor: 'rgba(37,99,235,0.1)', fill: true, tension: 0.3, pointRadius: 2 },
          { label: '退休目标', data: [], borderColor: CHART_COLORS[2], borderDash: [6, 3], pointRadius: 0, fill: false },
        ],
      },
      options: Object.assign({}, commonOpts, {
        scales: {
          x: { title: { display: true, text: '年龄' } },
          y: { title: { display: true, text: '金额 (元)' }, ticks: { callback: function (v) { return formatCNY(v); } } },
        },
        plugins: Object.assign({}, commonOpts.plugins, {
          tooltip: {
            callbacks: {
              label: function (ctx) { return ctx.dataset.label + ': ¥' + formatExact(ctx.parsed.y); },
            },
          },
        }),
      }),
    });

    // Chart 2: Cashflow (Income vs Expenses)
    const ctx2 = document.getElementById('chartCashflow').getContext('2d');
    charts.cashflow = new Chart(ctx2, {
      type: 'bar',
      data: {
        labels: [],
        datasets: [
          { label: '年收入', data: [], backgroundColor: CHART_COLORS[0], borderRadius: 3 },
          { label: '年支出', data: [], backgroundColor: CHART_COLORS[3], borderRadius: 3 },
        ],
      },
      options: Object.assign({}, commonOpts, {
        scales: {
          x: { title: { display: true, text: '年龄' } },
          y: { title: { display: true, text: '金额 (元)' }, ticks: { callback: function (v) { return formatCNY(v); } } },
        },
        plugins: Object.assign({}, commonOpts.plugins, {
          tooltip: {
            callbacks: {
              label: function (ctx) { return ctx.dataset.label + ': ¥' + formatExact(ctx.parsed.y); },
            },
          },
        }),
      }),
    });

    // Chart 3: Expense Breakdown (Doughnut)
    const ctx3 = document.getElementById('chartBreakdown').getContext('2d');
    charts.breakdown = new Chart(ctx3, {
      type: 'doughnut',
      data: {
        labels: [],
        datasets: [{ data: [], backgroundColor: CHART_COLORS }],
      },
      options: Object.assign({}, commonOpts, {
        plugins: Object.assign({}, commonOpts.plugins, {
          tooltip: {
            callbacks: {
              label: function (ctx) {
                var total = ctx.dataset.data.reduce(function (a, b) { return a + b; }, 0);
                var pct = ((ctx.parsed / total) * 100).toFixed(1);
                return ctx.label + ': ¥' + formatExact(ctx.parsed) + ' (' + pct + '%)';
              },
            },
          },
        }),
      }),
    });

    // Chart 4: Sensitivity Analysis (Line chart with multiple series)
    const ctx4 = document.getElementById('chartSensitivity').getContext('2d');
    charts.sensitivity = new Chart(ctx4, {
      type: 'line',
      data: {
        labels: [],
        datasets: [],
      },
      options: Object.assign({}, commonOpts, {
        scales: {
          x: { title: { display: true, text: '年龄' } },
          y: { title: { display: true, text: '退休存款 (元)' }, ticks: { callback: function (v) { return formatCNY(v); } } },
        },
      }),
    });
  }

  /** Update savings growth chart */
  function updateSavingsChart(yearlyData, targetSavings) {
    if (!charts.savings || !yearlyData || yearlyData.length === 0) return;

    const isReal = state.view === 'real';
    const labels = yearlyData.map(function (d) { return d.age; });
    const savingsData = yearlyData.map(function (d) { return isReal ? d.savingsReal : d.savings; });
    const targetData = yearlyData.map(function () { return targetSavings || 0; });

    charts.savings.data.labels = labels;
    charts.savings.data.datasets[0].data = savingsData;
    charts.savings.data.datasets[1].data = targetData;
    charts.savings.update();
  }

  /** Update cashflow chart */
  function updateCashflowChart(yearlyData) {
    if (!charts.cashflow || !yearlyData || yearlyData.length === 0) return;

    // Show every Nth label to avoid overcrowding
    const step = Math.max(1, Math.floor(yearlyData.length / 20));
    const labels = yearlyData.map(function (d) { return d.age; });
    const isReal = state.view === 'real';
    const incomeData = yearlyData.map(function (d) { return isReal ? d.totalIncomeReal : d.totalIncome; });
    const expenseData = yearlyData.map(function (d) { return isReal ? d.totalExpensesReal : d.totalExpenses; });

    charts.cashflow.data.labels = labels;
    charts.cashflow.data.datasets[0].data = incomeData;
    charts.cashflow.data.datasets[1].data = expenseData;
    charts.cashflow.update();
  }

  /** Update expense breakdown chart */
  function updateBreakdownChart(yearlyData, yearIndex) {
    if (!charts.breakdown || !yearlyData || yearlyData.length === 0) return;

    var idx = clamp(yearIndex || Math.floor(yearlyData.length / 2), 0, yearlyData.length - 1);
    var d = yearlyData[idx];
    var isReal = state.view === 'real';
    var inflFactor = isReal ? 1 : (state.view === 'nominal' ? 1 : 1);

    var labels = [];
    var values = [];

    if (d.baseLivingExpenses > 0) { labels.push('生活支出'); values.push(d.baseLivingExpenses); }
    if (d.childExpenses > 0) { labels.push('子女支出'); values.push(d.childExpenses); }
    if (d.liabilityPayments > 0) { labels.push('贷款还款'); values.push(d.liabilityPayments); }
    if (d.socialExpenses > 0) { labels.push('人情往来'); values.push(d.socialExpenses); }
    if (d.tax > 0) { labels.push('税费'); values.push(d.tax); }

    // Add "其他" catch-all
    var other = d.totalExpenses - (d.baseLivingExpenses + d.childExpenses + d.liabilityPayments + d.socialExpenses);
    if (other > 0) { labels.push('其他'); values.push(other); }

    charts.breakdown.data.labels = labels;
    charts.breakdown.data.datasets[0].data = values;
    charts.breakdown.update();
  }

  /** Update sensitivity chart */
  function updateSensitivityChart(params) {
    if (!charts.sensitivity) return;

    var inflRange = parseFloat(document.querySelector('[data-key="sensitivity.inflation"]').value) || 1;
    var retRange = parseFloat(document.querySelector('[data-key="sensitivity.return"]').value) || 1;
    document.getElementById('sensInflationVal').textContent = '±' + inflRange.toFixed(1) + '%';
    document.getElementById('sensReturnVal').textContent = '±' + retRange.toFixed(1) + '%';

    var baseInflation = params.economy.inflationRate;
    var baseReturn = params.economy.preRetireReturn;

    var scenarios = [
      { label: '基准方案', inflation: 0, return: 0 },
      { label: '高通胀', inflation: inflRange, return: 0 },
      { label: '低通胀', inflation: -inflRange, return: 0 },
      { label: '高收益', inflation: 0, return: retRange },
      { label: '低收益', inflation: 0, return: -retRange },
    ];

    var colors = ['#2563eb', '#ef4444', '#10b981', '#f59e0b', '#8b5cf6'];
    var datasets = [];
    var allLabels = [];

    scenarios.forEach(function (scenario, idx) {
      var p = JSON.parse(JSON.stringify(params));
      p.economy.inflationRate = Math.max(0, baseInflation + scenario.inflation);
      p.economy.preRetireReturn = Math.max(0, baseReturn + scenario.return);
      p.economy.postRetireReturn = Math.max(0, (params.economy.postRetireReturn || 3) + scenario.return * 0.6);

      // Use the current income value
      var data = Calculator.simulate(p);
      var savingsData = data.map(function (d) { return state.view === 'real' ? d.savingsReal : d.savings; });
      var labels = data.map(function (d) { return d.age; });

      if (idx === 0) {
        allLabels = labels;
      }

      datasets.push({
        label: scenario.label,
        data: savingsData,
        borderColor: colors[idx],
        backgroundColor: colors[idx] + '22',
        borderDash: idx === 0 ? [] : [4, 3],
        borderWidth: idx === 0 ? 2 : 1.5,
        pointRadius: 0,
        fill: false,
        tension: 0.3,
      });
    });

    charts.sensitivity.data.labels = allLabels;
    charts.sensitivity.data.datasets = datasets;
    charts.sensitivity.update();
  }

  /** Update the breakdown year selector */
  function updateBreakdownSelector(yearlyData) {
    var select = document.getElementById('breakdownYearSelect');
    if (!select) return;
    select.innerHTML = '';
    yearlyData.forEach(function (d) {
      var opt = document.createElement('option');
      opt.value = d.yearIndex;
      opt.textContent = d.year + '年 (年龄 ' + d.age + ') ' + (d.isRetired ? '🏖' : '💼');
      select.appendChild(opt);
    });
    // Default to retirement year or middle
    var targetIdx = yearlyData.findIndex(function (d) { return d.isRetired; });
    if (targetIdx < 0) targetIdx = Math.floor(yearlyData.length / 2);
    select.value = targetIdx;
  }

  // ============================================================
  // SECTION 8: Main Calculation & Render
  // ============================================================

  /** Main function: collect data, run simulation, render results */
  function runCalculation() {
    var params = collectFormData();

    // Validation
    if (params.basic.retirementAge <= params.basic.currentAge) {
      alert('退休年龄必须大于当前年龄。');
      return;
    }
    if (params.basic.lifeExpectancy <= params.basic.retirementAge) {
      alert('预期寿命必须大于退休年龄。');
      return;
    }

    var result;
    if (state.mode === 'goal-seeking') {
      result = Calculator.findRequiredMonthlyIncome(params);
      if (!result.achievable) {
        alert(result.error || '无法达到目标存款，请调整参数。');
        state.yearlyData = result.data || [];
        state.lastRequiredIncome = null;
        var summary = analyzeResults(state.yearlyData, params);
        renderSummaryCards(summary);
        renderDataTable(state.yearlyData, params);
        return;
      }
      state.lastRequiredIncome = result.requiredIncome;
      params.income.monthlySalary = result.requiredIncome;
      state.yearlyData = result.data;
    } else {
      result = Calculator.project(params);
      state.yearlyData = result.data;
      state.lastRequiredIncome = null;
    }

    // Analyze and render
    var summary = analyzeResults(state.yearlyData, params);
    renderSummaryCards(summary);
    renderDataTable(state.yearlyData, params);

    // Charts
    updateSavingsChart(state.yearlyData, params.target.targetSavings);
    updateCashflowChart(state.yearlyData);
    updateBreakdownSelector(state.yearlyData);
    var select = document.getElementById('breakdownYearSelect');
    if (select) {
      updateBreakdownChart(state.yearlyData, parseInt(select.value));
    }
    updateSensitivityChart(params);

    // Update income label in goal-seeking mode
    var incomeLabel = document.getElementById('incomeLabel');
    var incomeInput = document.getElementById('incomeInput');
    if (state.mode === 'goal-seeking' && result.requiredIncome !== null) {
      incomeLabel.textContent = '反推所需月收入';
      incomeInput.value = Math.round(result.requiredIncome);
    } else {
      incomeLabel.textContent = '当前税后月收入';
    }
  }

  // ============================================================
  // SECTION 9: Dynamic Field Management
  // ============================================================

  /** Add a child block */
  function addChild() {
    var list = document.getElementById('childList');
    var count = list.querySelectorAll('.dynamic-block').length;
    var div = document.createElement('div');
    div.className = 'dynamic-block child-block';
    div.setAttribute('data-index', count);
    div.innerHTML =
      '<div class="block-header">' +
        '<span class="block-title">子女 #' + (count + 1) + '</span>' +
        '<button class="btn-icon btn-remove" data-action="remove-child" title="删除">✕</button>' +
      '</div>' +
      '<div class="field-row">' +
        '<div class="field"><label>姓名/称呼</label><input type="text" data-key="children.' + count + '.name" value="宝宝"></div>' +
        '<div class="field"><label>年龄</label><input type="number" data-key="children.' + count + '.age" value="0" min="0" max="50" step="1"><span class="unit">岁</span></div>' +
      '</div>' +
      '<div class="field-row">' +
        '<div class="field"><label>月均开销/零花</label><input type="number" data-key="children.' + count + '.monthlyAllowance" value="1500" min="0" max="99999" step="100"><span class="unit">元/月</span></div>' +
        '<div class="field"><label>年教育费用</label><input type="number" data-key="children.' + count + '.annualEducation" value="20000" min="0" max="999999" step="1000"><span class="unit">元/年</span></div>' +
      '</div>' +
      '<div class="field-row">' +
        '<div class="field"><label>年兴趣班费用</label><input type="number" data-key="children.' + count + '.extracurricular" value="10000" min="0" max="999999" step="1000"><span class="unit">元/年</span></div>' +
        '<div class="field"><label>大学教育金目标</label><input type="number" data-key="children.' + count + '.collegeFund" value="200000" min="0" max="9999999" step="10000"><span class="unit">元</span></div>' +
      '</div>' +
      '<div class="field-row">' +
        '<div class="field"><label>预计经济独立年龄</label><input type="number" data-key="children.' + count + '.independenceAge" value="22" min="1" max="40" step="1"><span class="unit">岁</span></div>' +
      '</div>';
    list.appendChild(div);
  }

  /** Add a liability block */
  function addLiability() {
    var list = document.getElementById('liabilityList');
    var count = list.querySelectorAll('.dynamic-block').length;
    var div = document.createElement('div');
    div.className = 'dynamic-block';
    div.setAttribute('data-index', count);
    div.innerHTML =
      '<div class="block-header">' +
        '<span class="block-title">贷款 #' + (count + 1) + '</span>' +
        '<button class="btn-icon btn-remove" data-action="remove-liability" title="删除">✕</button>' +
      '</div>' +
      '<div class="field-row">' +
        '<div class="field"><label>贷款余额</label><input type="number" data-key="liabilities.' + count + '.total" value="100000" min="0" max="99999999" step="1000"><span class="unit">元</span></div>' +
        '<div class="field"><label>月供</label><input type="number" data-key="liabilities.' + count + '.monthlyPayment" value="2000" min="0" max="500000" step="100"><span class="unit">元</span></div>' +
      '</div>' +
      '<div class="field-row">' +
        '<div class="field"><label>剩余年限</label><input type="number" data-key="liabilities.' + count + '.remainingYears" value="5" min="1" max="50" step="1"><span class="unit">年</span></div>' +
        '<div class="field"><label>名称标签</label><input type="text" data-key="liabilities.' + count + '.label" value="贷款"></div>' +
      '</div>';
    list.appendChild(div);
  }

  /** Remove child block */
  function removeChild(block) {
    if (document.querySelectorAll('#childList .dynamic-block').length <= 1) {
      alert('至少保留一个子女。如无子女，将月开销设为 0。');
      return;
    }
    block.remove();
    reindexDynamic('#childList', 'children');
  }

  /** Remove liability block */
  function removeLiability(block) {
    block.remove();
    reindexDynamic('#liabilityList', 'liabilities');
  }

  /** Reindex data-key attributes after removal */
  function reindexDynamic(listSelector, prefix) {
    var blocks = document.querySelectorAll(listSelector + ' .dynamic-block');
    blocks.forEach(function (block, idx) {
      block.setAttribute('data-index', idx);
      // Update title
      var title = block.querySelector('.block-title');
      if (prefix === 'children') {
        title.textContent = '子女 #' + (idx + 1);
      } else {
        title.textContent = '贷款 #' + (idx + 1);
      }
      // Update all data-key attributes
      var inputs = block.querySelectorAll('[data-key]');
      inputs.forEach(function (inp) {
        var key = inp.getAttribute('data-key');
        var parts = key.split('.');
        parts[1] = idx;
        inp.setAttribute('data-key', parts.join('.'));
      });
    });
  }

  // ============================================================
  // SECTION 10: Mode & View Toggle
  // ============================================================

  function setMode(mode) {
    state.mode = mode;
    var btns = document.querySelectorAll('#modeToggle .toggle-btn');
    btns.forEach(function (b) {
      b.classList.toggle('active', b.getAttribute('data-mode') === mode);
    });

    var incomeLabel = document.getElementById('incomeLabel');
    var incomeInput = document.getElementById('incomeInput');
    var targetLabel = document.getElementById('targetLabel');
    var targetInput = document.getElementById('targetInput');

    if (mode === 'goal-seeking') {
      incomeLabel.textContent = '反推所得月收入';
      incomeInput.disabled = true;
      targetLabel.textContent = '退休目标存款';
      targetInput.disabled = false;
    } else {
      incomeLabel.textContent = '当前税后月收入';
      incomeInput.disabled = false;
      targetLabel.textContent = '退休目标存款（参考）';
      targetInput.disabled = false;
    }
  }

  function setView(view) {
    state.view = view;
    var btns = document.querySelectorAll('#viewToggle .toggle-btn');
    btns.forEach(function (b) {
      b.classList.toggle('active', b.getAttribute('data-view') === view);
    });
    // Re-render with new view
    if (state.yearlyData && state.yearlyData.length > 0) {
      var params = collectFormData();
      updateSavingsChart(state.yearlyData, params.target.targetSavings);
      updateCashflowChart(state.yearlyData);
      renderDataTable(state.yearlyData, params);
      var select = document.getElementById('breakdownYearSelect');
      if (select) {
        updateBreakdownChart(state.yearlyData, parseInt(select.value));
      }
    }
  }

  // ============================================================
  // SECTION 11: Export & Save
  // ============================================================

  function exportCSV() {
    if (!state.yearlyData || state.yearlyData.length === 0) {
      alert('请先进行计算。');
      return;
    }

    var isReal = state.view === 'real';
    var lines = ['年份,年龄,状态,年收入,年支出,贷款还款,税费,净现金流,年末存款'];
    state.yearlyData.forEach(function (d) {
      var status = d.isDepleted ? '耗尽' : (d.isRetired ? '退休' : '工作');
      var income = isReal ? d.totalIncomeReal : d.totalIncome;
      var expenses = isReal ? d.totalExpensesReal : d.totalExpenses;
      var savings = isReal ? d.savingsReal : d.savings;
      lines.push([
        d.year, d.age, status,
        round2(income), round2(expenses), round2(d.liabilityPayments || 0),
        round2(d.tax || 0), round2(d.netCashFlow), round2(savings),
      ].join(','));
    });

    var blob = new Blob(['﻿' + lines.join('\n')], { type: 'text/csv;charset=utf-8;' });
    var link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = '收入规划_明细.csv';
    link.click();
    URL.revokeObjectURL(link.href);
  }

  function saveConfig() {
    var params = collectFormData();
    try {
      localStorage.setItem('income-planner-config', JSON.stringify(params));
      alert('配置已保存到浏览器本地存储。');
    } catch (e) {
      alert('保存失败：' + e.message);
    }
  }

  function loadConfig() {
    try {
      var saved = localStorage.getItem('income-planner-config');
      if (saved) {
        var params = JSON.parse(saved);
        // Restore form values
        Object.keys(params).forEach(function (section) {
          var obj = params[section];
          if (Array.isArray(obj)) {
            // Handle arrays (children, liabilities) - skip, handled by DOM
          } else if (typeof obj === 'object') {
            Object.keys(obj).forEach(function (key) {
              var input = document.querySelector('[data-key="' + section + '.' + key + '"]');
              if (input) input.value = obj[key];
            });
          }
        });
        return true;
      }
    } catch (e) {
      // ignore
    }
    return false;
  }

  function resetDefaults() {
    Object.keys(DEFAULTS).forEach(function (section) {
      var obj = DEFAULTS[section];
      Object.keys(obj).forEach(function (key) {
        var input = document.querySelector('[data-key="' + section + '.' + key + '"]');
        if (input) input.value = obj[key];
      });
    });
    // Reset children to single default
    var childList = document.getElementById('childList');
    childList.innerHTML = '';
    addChild(); // This will add with index 0
    // Reset liabilities to single default mortgage
    var liabilityList = document.getElementById('liabilityList');
    // Clear and add default
    liabilityList.innerHTML = '';
    var defaultDiv = document.createElement('div');
    defaultDiv.className = 'dynamic-block';
    defaultDiv.setAttribute('data-index', '0');
    defaultDiv.innerHTML =
      '<div class="block-header">' +
        '<span class="block-title">房贷</span>' +
        '<button class="btn-icon btn-remove" data-action="remove-liability" title="删除">✕</button>' +
      '</div>' +
      '<div class="field-row">' +
        '<div class="field"><label>贷款余额</label><input type="number" data-key="liabilities.0.total" value="500000" min="0" max="99999999" step="1000"><span class="unit">元</span></div>' +
        '<div class="field"><label>月供</label><input type="number" data-key="liabilities.0.monthlyPayment" value="3500" min="0" max="500000" step="100"><span class="unit">元</span></div>' +
      '</div>' +
      '<div class="field-row">' +
        '<div class="field"><label>剩余年限</label><input type="number" data-key="liabilities.0.remainingYears" value="15" min="1" max="50" step="1"><span class="unit">年</span></div>' +
        '<div class="field"><label>名称标签</label><input type="text" data-key="liabilities.0.label" value="房贷"></div>' +
      '</div>';
    liabilityList.appendChild(defaultDiv);
  }

  // ============================================================
  // SECTION 12: Event Binding & Init
  // ============================================================

  function init() {
    // --- Collapsible sections ---
    document.getElementById('sidebar').addEventListener('click', function (e) {
      var header = e.target.closest('.section-header');
      if (!header) return;
      if (e.target.closest('.btn-icon')) return;
      var bodyId = header.getAttribute('data-toggle');
      var body = document.getElementById(bodyId);
      if (body) {
        body.classList.toggle('collapsed');
        body.classList.remove('collapsed-on-mobile');
        header.querySelector('.section-chevron').classList.toggle('open');
      }
    });

    // --- Chart tabs ---
    document.getElementById('chartTabs').addEventListener('click', function (e) {
      var tab = e.target.closest('.chart-tab');
      if (!tab) return;
      document.querySelectorAll('.chart-tab').forEach(function (t) { t.classList.remove('active'); });
      tab.classList.add('active');

      var chart = tab.getAttribute('data-chart');
      document.getElementById('chartSavings').style.display = chart === 'savings' ? '' : 'none';
      document.getElementById('chartCashflow').style.display = chart === 'cashflow' ? '' : 'none';
      document.getElementById('chartBreakdownContainer').style.display = chart === 'breakdown' ? '' : 'none';
      document.getElementById('chartSensitivityContainer').style.display = chart === 'sensitivity' ? '' : 'none';
    });

    // --- Mode toggle ---
    document.getElementById('modeToggle').addEventListener('click', function (e) {
      var btn = e.target.closest('.toggle-btn');
      if (!btn || btn.classList.contains('active')) return;
      setMode(btn.getAttribute('data-mode'));
    });

    // --- View toggle ---
    document.getElementById('viewToggle').addEventListener('click', function (e) {
      var btn = e.target.closest('.toggle-btn');
      if (!btn || btn.classList.contains('active')) return;
      setView(btn.getAttribute('data-view'));
    });

    // --- Calculate button ---
    document.getElementById('btnCalculate').addEventListener('click', runCalculation);

    // --- Reset button ---
    document.getElementById('btnReset').addEventListener('click', function () {
      if (confirm('确定要重置所有参数为默认值吗？')) {
        resetDefaults();
      }
    });

    // --- Export CSV ---
    document.getElementById('btnExportCSV').addEventListener('click', exportCSV);

    // --- Save config ---
    document.getElementById('btnSaveConfig').addEventListener('click', saveConfig);

    // --- Dynamic add: children ---
    document.querySelector('[data-action="add-child"]').addEventListener('click', addChild);

    // --- Dynamic add: liabilities ---
    document.querySelector('[data-action="add-liability"]').addEventListener('click', addLiability);

    // --- Dynamic remove (delegated) ---
    document.addEventListener('click', function (e) {
      var btn = e.target.closest('[data-action]');
      if (!btn) return;
      var action = btn.getAttribute('data-action');
      if (action === 'remove-child') {
        removeChild(btn.closest('.dynamic-block'));
      } else if (action === 'remove-liability') {
        removeLiability(btn.closest('.dynamic-block'));
      }
    });

    // --- Breakdown year selector ---
    document.getElementById('breakdownYearSelect').addEventListener('change', function () {
      if (state.yearlyData && state.yearlyData.length > 0) {
        updateBreakdownChart(state.yearlyData, parseInt(this.value));
      }
    });

    // --- Sensitivity sliders ---
    document.querySelectorAll('[data-key^="sensitivity."]').forEach(function (slider) {
      slider.addEventListener('input', function () {
        if (state.yearlyData && state.yearlyData.length > 0) {
          var params = collectFormData();
          updateSensitivityChart(params);
        }
      });
    });

    // --- Keyboard shortcut: Enter to calculate ---
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Enter' && e.target.tagName === 'INPUT') {
        runCalculation();
      }
    });

    // --- Init charts ---
    initCharts();

    // --- Set default mode ---
    setMode('goal-seeking');

    // --- Auto-collapse sections on mobile ---
    if (window.innerWidth <= 1024) {
      document.querySelectorAll('.section-body').forEach(function (body) {
        body.classList.add('collapsed', 'collapsed-on-mobile');
      });
      document.querySelectorAll('.section-chevron').forEach(function (chev) {
        chev.classList.add('open');
      });
    }

    // --- Try loading saved config ---
    loadConfig();

    // --- Auto-calculate on load ---
    setTimeout(runCalculation, 100);
  }

  // Start when DOM is ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

})();
