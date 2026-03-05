import Foundation
import HealthKit
import WebKit

class HealthKitSync {
    static let shared = HealthKitSync()
    private let store = HKHealthStore()

    private let readTypes: Set<HKObjectType> = {
        var types = Set<HKObjectType>()
        let ids: [HKQuantityTypeIdentifier] = [
            .stepCount, .activeEnergyBurned, .basalEnergyBurned,
            .heartRateVariabilitySDNN, .restingHeartRate, .appleExerciseTime,
        ]
        for id in ids {
            if let t = HKQuantityType.quantityType(forIdentifier: id) { types.insert(t) }
        }
        if let sleep = HKObjectType.categoryType(forIdentifier: .sleepAnalysis) { types.insert(sleep) }
        return types
    }()

    // checkStatusAndNotify: we can't reliably detect read-only HealthKit auth status.
    // The web uses Supabase health_apple data presence as the true "connected" signal.
    // We only dispatch "authorized" after a successful sync posts data to Supabase.
    func checkStatusAndNotify(webView: WKWebView) {
        // No-op: don't claim authorized — web checks Supabase for real data instead
    }

    // Request permission — note: 'granted' means "request completed", NOT "user allowed"
    // The only real signal is whether subsequent HealthKit queries return data.
    func requestPermission(completion: @escaping (Bool) -> Void) {
        guard HKHealthStore.isHealthDataAvailable() else {
            print("DAYLAB-HK: isHealthDataAvailable = FALSE")
            completion(false)
            return
        }
        print("DAYLAB-HK: isHealthDataAvailable = TRUE, calling requestAuthorization...")
        print("DAYLAB-HK: readTypes count = \(readTypes.count)")
        store.requestAuthorization(toShare: nil, read: readTypes) { _, error in
            print("DAYLAB-HK: requestAuthorization completed, error = \(String(describing: error))")
            // Always treat as success here — the sync will return empty if denied
            // Web will show "connected" only if Supabase health_apple data appears
            DispatchQueue.main.async { completion(true) }
        }
    }

    // Sync a specific date — called after requestAuthorization
    func syncHealthKit(token: String, date: Date, webView: WKWebView? = nil) {
        guard HKHealthStore.isHealthDataAvailable() else { return }
        if let wv = webView {
            DispatchQueue.main.async {
                wv.evaluateJavaScript("""
                    window.dispatchEvent(new CustomEvent('daylabHealthKit', {
                        detail: { status: 'authorized' }
                    }));
                """, completionHandler: nil)
            }
        }
        self.syncDate(token: token, date: date)
    }

    // Request permission then sync — legacy path
    func requestPermissionAndSync(token: String, date: Date, webView: WKWebView? = nil) {
        guard HKHealthStore.isHealthDataAvailable() else { return }
        store.requestAuthorization(toShare: nil, read: readTypes) { granted, _ in
            // Notify web view of updated status
            if let wv = webView {
                DispatchQueue.main.async {
                    let statusStr = granted ? "authorized" : "denied"
                    wv.evaluateJavaScript("""
                        window.dispatchEvent(new CustomEvent('daylabHealthKit', {
                            detail: { status: '\(statusStr)' }
                        }));
                    """, completionHandler: nil)
                }
            }
            guard granted else { return }
            self.syncDate(token: token, date: date)
        }
    }

    private func syncDate(token: String, date: Date) {
        let cal = Calendar.current
        let start = cal.startOfDay(for: date)
        let end   = cal.date(byAdding: .day, value: 1, to: start)!
        let dateStr = ISO8601DateFormatter().string(from: start).prefix(10).description

        var result: [String: Any] = ["date": dateStr]
        let group = DispatchGroup()

        // Steps
        group.enter()
        sumQuery(.stepCount, unit: .count(), start: start, end: end) { val in
            if let v = val { result["steps"] = String(Int(v)) }
            group.leave()
        }

        // Active calories
        group.enter()
        sumQuery(.activeEnergyBurned, unit: .kilocalorie(), start: start, end: end) { val in
            if let v = val { result["activeCalories"] = String(Int(v)) }
            group.leave()
        }

        // Basal calories
        group.enter()
        sumQuery(.basalEnergyBurned, unit: .kilocalorie(), start: start, end: end) { val in
            if let v = val {
                let active = Double(result["activeCalories"] as? String ?? "0") ?? 0
                result["totalCalories"] = String(Int(v + active))
            }
            group.leave()
        }

        // Resting heart rate
        group.enter()
        mostRecentQuery(.restingHeartRate, unit: HKUnit(from: "count/min"), start: start, end: end) { val in
            if let v = val { result["rhr"] = String(Int(v)) }
            group.leave()
        }

        // HRV
        group.enter()
        mostRecentQuery(.heartRateVariabilitySDNN, unit: .secondUnit(with: .milli), start: start, end: end) { val in
            if let v = val { result["hrv"] = String(Int(v)) }
            group.leave()
        }

        // Active minutes (exercise time)
        group.enter()
        sumQuery(.appleExerciseTime, unit: .minute(), start: start, end: end) { val in
            if let v = val { result["activeMinutes"] = String(Int(v)) }
            group.leave()
        }

        // Sleep
        group.enter()
        sleepQuery(start: start, end: end) { hrs, eff in
            if let h = hrs { result["sleepHrs"] = String(format: "%.1f", h) }
            if let e = eff { result["sleepEff"]  = String(Int(e)) }
            group.leave()
        }

        group.notify(queue: .global()) {
            self.postToAPI(data: result, token: token)
        }
    }

    private func sumQuery(_ id: HKQuantityTypeIdentifier, unit: HKUnit, start: Date, end: Date, completion: @escaping (Double?) -> Void) {
        guard let type = HKQuantityType.quantityType(forIdentifier: id) else { completion(nil); return }
        let pred = HKQuery.predicateForSamples(withStart: start, end: end, options: .strictStartDate)
        let q = HKStatisticsQuery(quantityType: type, quantitySamplePredicate: pred, options: .cumulativeSum) { _, stats, _ in
            completion(stats?.sumQuantity()?.doubleValue(for: unit))
        }
        store.execute(q)
    }

    private func mostRecentQuery(_ id: HKQuantityTypeIdentifier, unit: HKUnit, start: Date, end: Date, completion: @escaping (Double?) -> Void) {
        guard let type = HKQuantityType.quantityType(forIdentifier: id) else { completion(nil); return }
        let pred = HKQuery.predicateForSamples(withStart: start, end: end, options: .strictStartDate)
        let q = HKStatisticsQuery(quantityType: type, quantitySamplePredicate: pred, options: .discreteAverage) { _, stats, _ in
            completion(stats?.averageQuantity()?.doubleValue(for: unit))
        }
        store.execute(q)
    }

    private func sleepQuery(start: Date, end: Date, completion: @escaping (Double?, Double?) -> Void) {
        guard let type = HKObjectType.categoryType(forIdentifier: .sleepAnalysis) else { completion(nil, nil); return }
        let pred = HKQuery.predicateForSamples(withStart: start, end: end, options: .strictStartDate)
        let q = HKSampleQuery(sampleType: type, predicate: pred, limit: HKObjectQueryNoLimit, sortDescriptors: nil) { _, samples, _ in
            let asleep = samples?.compactMap { $0 as? HKCategorySample }
                .filter { $0.value == HKCategoryValueSleepAnalysis.asleepUnspecified.rawValue ||
                          $0.value == HKCategoryValueSleepAnalysis.asleepCore.rawValue ||
                          $0.value == HKCategoryValueSleepAnalysis.asleepDeep.rawValue ||
                          $0.value == HKCategoryValueSleepAnalysis.asleepREM.rawValue } ?? []
            let totalSecs = asleep.reduce(0.0) { $0 + $1.endDate.timeIntervalSince($1.startDate) }
            let hrs = totalSecs > 0 ? totalSecs / 3600 : nil
            completion(hrs, nil) // efficiency not available from HealthKit directly
        }
        store.execute(q)
    }

    private func postToAPI(data: [String: Any], token: String) {
        guard let url = URL(string: "https://www.daylab.me/api/health-sync") else { return }
        var req = URLRequest(url: url)
        req.httpMethod = "POST"
        req.setValue("application/json", forHTTPHeaderField: "Content-Type")
        req.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
        req.httpBody = try? JSONSerialization.data(withJSONObject: data)
        URLSession.shared.dataTask(with: req) { _, _, _ in }.resume()
    }
}
