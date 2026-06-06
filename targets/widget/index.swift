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
    let verified: Bool
    let imageURL: String
    var image: UIImage? = nil
}

// MARK: - Data loading from the App Group

func loadFeedPosts() -> [FeedPost] {
    guard let defaults = UserDefaults(suiteName: appGroup) else { return [] }
    guard let raw = defaults.string(forKey: feedKey),
          let data = raw.data(using: .utf8) else { return [] }
    guard let arr = (try? JSONSerialization.jsonObject(with: data)) as? [[String: Any]] else { return [] }

    return arr.prefix(4).map { item in
        FeedPost(
            id: (item["id"] as? String) ?? UUID().uuidString,
            author: (item["author"] as? String) ?? "User",
            emoji: (item["emoji"] as? String) ?? "😊",
            content: (item["content"] as? String) ?? "",
            verified: (item["verified"] as? Bool) ?? false,
            imageURL: (item["image"] as? String) ?? ""
        )
    }
}

// Download the images for the posts that have an imageURL. Widgets must fetch
// images in the timeline provider (synchronously resolved before the timeline
// is returned), so we use a dispatch group with a short timeout.
func loadImages(for posts: [FeedPost], completion: @escaping ([FeedPost]) -> Void) {
    var result = posts
    let group = DispatchGroup()

    for (index, post) in posts.enumerated() {
        guard !post.imageURL.isEmpty, let url = URL(string: post.imageURL) else { continue }
        group.enter()
        let task = URLSession.shared.dataTask(with: url) { data, _, _ in
            if let data = data, let img = UIImage(data: data) {
                result[index].image = img
            }
            group.leave()
        }
        task.resume()
    }

    // Wait up to ~8s for images, then return whatever we have.
    DispatchQueue.global().async {
        _ = group.wait(timeout: .now() + 8)
        DispatchQueue.main.async { completion(result) }
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
            FeedPost(id: "1", author: "San", emoji: "✨", content: "Последние посты появятся здесь", verified: false, imageURL: "")
        ])
    }

    func getSnapshot(in context: Context, completion: @escaping (SanEntry) -> Void) {
        completion(SanEntry(date: Date(), posts: loadFeedPosts()))
    }

    func getTimeline(in context: Context, completion: @escaping (Timeline<SanEntry>) -> Void) {
        let posts = loadFeedPosts()
        loadImages(for: posts) { withImages in
            let entry = SanEntry(date: Date(), posts: withImages)
            let next = Calendar.current.date(byAdding: .minute, value: 30, to: Date()) ?? Date()
            completion(Timeline(entries: [entry], policy: .after(next)))
        }
    }
}

// MARK: - Views

struct PostRow: View {
    let post: FeedPost
    let showImage: Bool

    var body: some View {
        HStack(alignment: .top, spacing: 8) {
            Text(post.emoji).font(.system(size: 15))
            VStack(alignment: .leading, spacing: 2) {
                HStack(spacing: 3) {
                    Text(post.author)
                        .font(.system(size: 12, weight: .semibold))
                        .lineLimit(1)
                    if post.verified {
                        Image(systemName: "checkmark.seal.fill")
                            .font(.system(size: 10))
                            .foregroundColor(.blue)
                    }
                }
                if !post.content.isEmpty {
                    Text(post.content)
                        .font(.system(size: 11))
                        .foregroundColor(.secondary)
                        .lineLimit(2)
                }
            }
            Spacer(minLength: 0)
            if showImage, let img = post.image {
                Image(uiImage: img)
                    .resizable()
                    .aspectRatio(contentMode: .fill)
                    .frame(width: 40, height: 40)
                    .clipShape(RoundedRectangle(cornerRadius: 8))
            }
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
        VStack(alignment: .leading, spacing: 8) {
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
                    PostRow(post: post, showImage: family != .systemSmall)
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
