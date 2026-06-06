import WidgetKit
import SwiftUI

// MARK: - Shared constants

let appGroup = "group.com.sanmes.app"
let feedKey = "widget_feed_posts"

// MARK: - Model

struct FeedPost: Identifiable {
    let id: String
    let author: String
    let emoji: String
    let content: String
}

// MARK: - Data loading from the App Group

func loadFeedPosts() -> [FeedPost] {
    guard let defaults = UserDefaults(suiteName: appGroup),
          let raw = defaults.string(forKey: feedKey),
          let data = raw.data(using: .utf8),
          let arr = try? JSONSerialization.jsonObject(with: data) as? [[String: Any]]
    else {
        return []
    }
    return arr.prefix(4).map { item in
        FeedPost(
            id: (item["id"] as? String) ?? UUID().uuidString,
            author: (item["author"] as? String) ?? "User",
            emoji: (item["emoji"] as? String) ?? "😊",
            content: (item["content"] as? String) ?? ""
        )
    }
}

// MARK: - Timeline

struct SanEntry: TimelineEntry {
    let date: Date
    let posts: [FeedPost]
}

struct Provider: TimelineProvider {
    func placeholder(in context: Context) -> SanEntry {
        SanEntry(date: Date(), posts: [
            FeedPost(id: "1", author: "San", emoji: "✨", content: "Последние посты появятся здесь")
        ])
    }

    func getSnapshot(in context: Context, completion: @escaping (SanEntry) -> Void) {
        completion(SanEntry(date: Date(), posts: loadFeedPosts()))
    }

    func getTimeline(in context: Context, completion: @escaping (Timeline<SanEntry>) -> Void) {
        let entry = SanEntry(date: Date(), posts: loadFeedPosts())
        // Refresh roughly every 30 minutes; the app also reloads on new data.
        let next = Calendar.current.date(byAdding: .minute, value: 30, to: Date()) ?? Date()
        completion(Timeline(entries: [entry], policy: .after(next)))
    }
}

// MARK: - Views

struct PostRow: View {
    let post: FeedPost
    var body: some View {
        HStack(alignment: .top, spacing: 6) {
            Text(post.emoji).font(.system(size: 14))
            VStack(alignment: .leading, spacing: 1) {
                Text(post.author)
                    .font(.system(size: 12, weight: .semibold))
                    .lineLimit(1)
                Text(post.content.isEmpty ? "—" : post.content)
                    .font(.system(size: 11))
                    .foregroundColor(.secondary)
                    .lineLimit(2)
            }
            Spacer(minLength: 0)
        }
    }
}

struct SanWidgetEntryView: View {
    var entry: Provider.Entry
    @Environment(\.widgetFamily) var family

    var maxPosts: Int {
        switch family {
        case .systemLarge: return 4
        case .systemMedium: return 2
        default: return 1
        }
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            HStack(spacing: 4) {
                Text("San").font(.system(size: 13, weight: .bold))
                Spacer()
                Image(systemName: "sparkles").font(.system(size: 11)).foregroundColor(.orange)
            }
            if entry.posts.isEmpty {
                Spacer()
                Text("Открой San, чтобы загрузить ленту")
                    .font(.system(size: 11))
                    .foregroundColor(.secondary)
                Spacer()
            } else {
                ForEach(entry.posts.prefix(maxPosts)) { post in
                    PostRow(post: post)
                }
                Spacer(minLength: 0)
            }
        }
        .padding(12)
        .widgetBackgroundCompat(Color(.systemBackground))
    }
}

// iOS 17 requires containerBackground; iOS 16 uses a plain background.
extension View {
    @ViewBuilder
    func widgetBackgroundCompat(_ color: Color) -> some View {
        if #available(iOS 17.0, *) {
            self.containerBackground(color, for: .widget)
        } else {
            self.background(color)
        }
    }
}

// MARK: - Widget

@main
struct SanWidget: Widget {
    let kind: String = "SanWidget"

    var body: some WidgetConfiguration {
        StaticConfiguration(kind: kind, provider: Provider()) { entry in
            SanWidgetEntryView(entry: entry)
        }
        .configurationDisplayName("Лента San")
        .description("Последние посты из вашей ленты.")
        .supportedFamilies([.systemSmall, .systemMedium, .systemLarge])
    }
}
