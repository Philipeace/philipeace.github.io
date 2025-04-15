// static/chart.js

let historyChart = null; // Keep chart instance reference local to this module/scope

function renderHistoryChart(ctx, historyData, period) {
    if (historyChart) {
        historyChart.destroy();
        historyChart = null;
    }
    if (!ctx || !historyData || historyData.length === 0) {
        if(ctx) ctx.clearRect(0, 0, ctx.canvas.width, ctx.canvas.height); // Clear canvas if no data
        return; // Cannot render chart
    }

    const labels = historyData.map(point => new Date(point.timestamp));
    const responseTimes = historyData.map(point => point.status === 'UP' ? point.response_time_ms : null);
    const statusColors = historyData.map(point => {
        switch (point.status) {
            case 'UP': return 'rgba(30, 138, 70, 0.7)'; // Green
            case 'DOWN': return 'rgba(235, 72, 54, 0.7)'; // Red
            case 'ERROR': return 'rgba(226, 113, 29, 0.7)'; // Orange
            default: return 'rgba(90, 90, 90, 0.7)'; // Gray
        }
    });

    // --- Chart.js Configuration ---
    historyChart = new Chart(ctx, {
        type: 'line',
        data: {
            labels: labels,
            datasets: [
                {
                    label: 'Response Time (ms)',
                    data: responseTimes,
                    borderColor: 'var(--cocoa-brown)',
                    backgroundColor: 'transparent',
                    borderWidth: 2,
                    tension: 0.1,
                    pointRadius: 3,
                    pointHoverRadius: 5,
                    pointBackgroundColor: 'var(--cocoa-brown)',
                    spanGaps: false, // Don't connect across null values (DOWN/ERROR states)
                    yAxisID: 'yResponseTime',
                    order: 1
                },
                {
                    label: 'Status',
                    data: historyData.map((point, index) => ({
                        x: labels[index], // Timestamp for x-axis
                        y: 0 // Plot status points along the x-axis (y=0)
                    })),
                    pointBackgroundColor: statusColors,
                    pointRadius: 5,
                    pointHoverRadius: 7,
                    borderColor: 'transparent', // No line for status points
                    backgroundColor: 'transparent',
                    showLine: false,
                    yAxisID: 'yStatus', // Use the hidden y-axis
                    order: 0
                }
            ]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            scales: {
                x: {
                    type: 'time',
                    time: {
                        unit: inferTimeScaleUnit(period),
                        tooltipFormat: 'PPp', // locale dependent format: Sep 4, 2023, 2:30:45 PM
                        displayFormats: { // More granular display formats
                            millisecond: 'HH:mm:ss.SSS',
                            second: 'HH:mm:ss',
                            minute: 'HH:mm',
                            hour: period === '1h' ? 'HH:mm' : 'MMM d HH:00', // HH:mm for 1h, else Day+Hour
                            day: 'MMM d',
                            week: 'MMM d',
                            month: 'MMM yyyy',
                            quarter: 'qqq yyyy',
                            year: 'yyyy',
                        }
                    },
                    title: { display: true, text: 'Time', color: 'var(--isabelline)' },
                    ticks: { color: '#ccc', maxRotation: 0, autoSkip: true, autoSkipPadding: 15 }, // Improve tick spacing/rotation
                    grid: { color: 'rgba(242, 233, 228, 0.1)' }
                },
                yResponseTime: {
                    position: 'left',
                    beginAtZero: true,
                    title: { display: true, text: 'Response Time (ms)', color: 'var(--isabelline)' },
                    ticks: { color: '#ccc' },
                    grid: { color: 'rgba(242, 233, 228, 0.1)' }
                },
                yStatus: { // Hidden axis for status points
                    position: 'right',
                    beginAtZero: true,
                    display: false,
                    min: -1, // Give points some space from axis line
                    max: 1
                }
            },
            plugins: {
                legend: { display: false }, // Keep legend hidden
                tooltip: {
                    enabled: true,
                    mode: 'index', // Show tooltips for points at the same x-index
                    intersect: false,
                    callbacks: {
                        label: function(context) {
                            // Tooltip logic from previous version
                            if (!historyData || !historyData[context.dataIndex]) return null;
                            const originalData = historyData[context.dataIndex];
                            let label = '';
                            if (context.datasetIndex === 0 && context.parsed.y !== null) {
                                label = `Resp. Time: ${context.parsed.y} ms`;
                                if (originalData.status === 'UP') label += ` (Status: UP)`;
                                return label;
                            } else if (context.datasetIndex === 1) {
                                if (originalData.response_time_ms === null || originalData.response_time_ms === undefined) {
                                    return `Status: ${originalData.status}`;
                                } else { return null; }
                            }
                            return null;
                        }
                    }
                }
            },
            interaction: {
                mode: 'nearest', // Find nearest item in all datasets
                axis: 'x',
                intersect: false
            }
        }
    });
}

function inferTimeScaleUnit(period) {
    switch (period) {
        case '1h': return 'minute';
        case '24h': return 'hour';
        case '7d': return 'day';
        default: return 'hour';
    }
}