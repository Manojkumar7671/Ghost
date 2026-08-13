import json
import statistics

def calculate_stats(data):
    mean = statistics.mean(data)
    median = statistics.median(data)
    std_dev = statistics.stdev(data)
    return mean, median, std_dev

def export_json_report(mean, median, std_dev, filename='stats_report.json'):
    report = {
        'mean': mean,
        'median': median,
        'standard_deviation': std_dev
    }
    with open(filename, 'w') as f:
        json.dump(report, f, indent=4)

def main():
    # Example dataset
    data = [1, 2, 3, 4, 5]
    mean, median, std_dev = calculate_stats(data)
    print(f'Mean: {mean}, Median: {median}, Standard Deviation: {std_dev}')
    export_json_report(mean, median, std_dev)

if __name__ == '__main__':
    main()