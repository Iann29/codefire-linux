import SwiftUI

struct NotificationBellView: View {
    @ObservedObject var premiumService = PremiumService.shared
    @State private var showPopover = false

    var body: some View {
        Button {
            showPopover.toggle()
            if showPopover {
                Task {
                    try? await premiumService.fetchNotifications()
                }
            }
        } label: {
            ZStack(alignment: .topTrailing) {
                Image(systemName: "bell")
                    .font(.system(size: 12, weight: .medium))
                    .foregroundColor(showPopover ? .accentColor : .secondary)
                    .frame(width: 28, height: 28)
                    .background(
                        RoundedRectangle(cornerRadius: 6)
                            .fill(showPopover ? Color.accentColor.opacity(0.12) : Color.clear)
                    )

                if premiumService.unreadCount > 0 {
                    Text("\(min(premiumService.unreadCount, 99))")
                        .font(.system(size: 7, weight: .bold))
                        .foregroundColor(.white)
                        .padding(.horizontal, 3)
                        .padding(.vertical, 1)
                        .background(Capsule().fill(Color.red))
                        .offset(x: 4, y: -4)
                }
            }
        }
        .buttonStyle(.plain)
        .help("Team Notifications")
        .popover(isPresented: $showPopover, arrowEdge: .bottom) {
            NotificationPopoverContent(premiumService: premiumService)
                .frame(width: 320, height: 400)
        }
    }
}

// MARK: - Popover Content

private struct NotificationPopoverContent: View {
    @ObservedObject var premiumService: PremiumService

    var body: some View {
        VStack(spacing: 0) {
            // Header
            HStack {
                Text("Notifications")
                    .font(.system(size: 13, weight: .semibold))

                if premiumService.unreadCount > 0 {
                    Text("\(premiumService.unreadCount)")
                        .font(.system(size: 10, weight: .bold))
                        .foregroundColor(.white)
                        .padding(.horizontal, 5)
                        .padding(.vertical, 1)
                        .background(Capsule().fill(Color.red))
                }

                Spacer()

                if premiumService.unreadCount > 0 {
                    Button("Mark all read") {
                        Task {
                            try? await premiumService.markAllRead()
                        }
                    }
                    .font(.system(size: 10))
                    .foregroundColor(.accentColor)
                    .buttonStyle(.plain)
                }
            }
            .padding(.horizontal, 14)
            .padding(.vertical, 10)

            Divider()

            if premiumService.notifications.isEmpty {
                VStack(spacing: 8) {
                    Image(systemName: "bell.slash")
                        .font(.system(size: 22))
                        .foregroundColor(.secondary.opacity(0.5))
                    Text("No notifications")
                        .font(.system(size: 12))
                        .foregroundColor(.secondary)
                }
                .frame(maxWidth: .infinity, maxHeight: .infinity)
            } else {
                ScrollView {
                    LazyVStack(spacing: 1) {
                        ForEach(premiumService.notifications) { notification in
                            NotificationRow(notification: notification) {
                                Task {
                                    try? await premiumService.markRead(notificationId: notification.id)
                                }
                            }
                        }
                    }
                    .padding(.vertical, 4)
                }
            }
        }
    }
}

// MARK: - Notification Row

private struct NotificationRow: View {
    let notification: PremiumNotification
    let onMarkRead: () -> Void

    var body: some View {
        HStack(alignment: .top, spacing: 10) {
            // Unread dot
            Circle()
                .fill(notification.isRead ? Color.clear : Color.accentColor)
                .frame(width: 6, height: 6)
                .padding(.top, 5)

            // Icon
            Image(systemName: iconForType(notification.type))
                .font(.system(size: 11))
                .foregroundColor(colorForType(notification.type))
                .frame(width: 20, height: 20)

            VStack(alignment: .leading, spacing: 3) {
                Text(notification.title)
                    .font(.system(size: 12, weight: notification.isRead ? .regular : .medium))
                    .lineLimit(2)

                if let body = notification.body, !body.isEmpty {
                    Text(body)
                        .font(.system(size: 11))
                        .foregroundColor(.secondary)
                        .lineLimit(2)
                }
            }

            Spacer()
        }
        .padding(.horizontal, 14)
        .padding(.vertical, 8)
        .background(notification.isRead ? Color.clear : Color.accentColor.opacity(0.04))
        .contentShape(Rectangle())
        .onTapGesture {
            if !notification.isRead {
                onMarkRead()
            }
        }
    }

    private func iconForType(_ type: String) -> String {
        switch type {
        case "review_requested": return "arrow.triangle.pull"
        case "review_resolved": return "checkmark.seal"
        case "mention": return "at"
        case "invite": return "person.badge.plus"
        case "session_shared": return "clock.arrow.circlepath"
        case "doc_updated": return "doc"
        default: return "bell"
        }
    }

    private func colorForType(_ type: String) -> Color {
        switch type {
        case "review_requested": return .orange
        case "review_resolved": return .green
        case "mention": return .blue
        case "invite": return .purple
        case "session_shared": return .cyan
        case "doc_updated": return .indigo
        default: return .secondary
        }
    }
}
