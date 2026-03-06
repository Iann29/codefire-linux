import SwiftUI

struct PresenceAvatarsView: View {
    @ObservedObject var premiumService = PremiumService.shared
    let projectId: String?

    @State private var onlineMembers: [TeamMember] = []

    var body: some View {
        Group {
            if !premiumService.status.enabled || !premiumService.status.authenticated {
                EmptyView()
            } else if onlineMembers.isEmpty {
                EmptyView()
            } else {
                HStack(spacing: -6) {
                    ForEach(onlineMembers.prefix(5), id: \.userId) { member in
                        memberAvatar(member)
                    }

                    if onlineMembers.count > 5 {
                        Text("+\(onlineMembers.count - 5)")
                            .font(.system(size: 8, weight: .bold))
                            .foregroundColor(.secondary)
                            .frame(width: 22, height: 22)
                            .background(
                                Circle()
                                    .fill(Color(nsColor: .controlBackgroundColor))
                                    .overlay(
                                        Circle()
                                            .stroke(Color(nsColor: .separatorColor).opacity(0.5), lineWidth: 1)
                                    )
                            )
                    }
                }
            }
        }
        .task {
            await loadPresence()
        }
    }

    private func memberAvatar(_ member: TeamMember) -> some View {
        let name = member.user?.displayName ?? member.userId
        let initials = String(name.prefix(2).uppercased())

        return ZStack {
            Circle()
                .fill(colorForUser(member.userId))
                .frame(width: 22, height: 22)
                .overlay(
                    Circle()
                        .stroke(Color(nsColor: .windowBackgroundColor), lineWidth: 2)
                )

            Text(initials)
                .font(.system(size: 8, weight: .bold))
                .foregroundColor(.white)
        }
        .help(name)
    }

    private func loadPresence() async {
        guard let teamId = premiumService.status.team?.id else { return }
        do {
            let allMembers = try await premiumService.listMembers(teamId: teamId)
            // For now, show all team members as "online" since we don't
            // have a real-time presence API yet. A future implementation
            // would use WebSocket or polling for actual presence.
            onlineMembers = allMembers
        } catch {
            print("Presence: failed to load: \(error)")
        }
    }

    private func colorForUser(_ id: String) -> Color {
        let hash = abs(id.hashValue)
        let colors: [Color] = [.blue, .purple, .orange, .green, .pink, .cyan, .indigo, .mint]
        return colors[hash % colors.count]
    }
}
