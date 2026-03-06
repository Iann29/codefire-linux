import SwiftUI

struct ReviewRequestsView: View {
    @EnvironmentObject var appState: AppState
    @State private var reviews: [ReviewRequest] = []
    @State private var isLoading = false
    @State private var showNewReview = false

    private var premiumService: PremiumService { PremiumService.shared }

    private var pendingReviews: [ReviewRequest] {
        reviews.filter { $0.status == "pending" }
    }

    private var approvedReviews: [ReviewRequest] {
        reviews.filter { $0.status == "approved" }
    }

    private var changesRequestedReviews: [ReviewRequest] {
        reviews.filter { $0.status == "changes_requested" }
    }

    private var dismissedReviews: [ReviewRequest] {
        reviews.filter { $0.status == "dismissed" }
    }

    var body: some View {
        VStack(spacing: 0) {
            // Header
            HStack {
                Text("Reviews")
                    .font(.system(size: 13, weight: .semibold))

                if !reviews.isEmpty {
                    Text("\(pendingReviews.count) pending")
                        .font(.system(size: 10, weight: .medium))
                        .foregroundColor(.orange)
                        .padding(.horizontal, 6)
                        .padding(.vertical, 2)
                        .background(
                            Capsule().fill(Color.orange.opacity(0.12))
                        )
                }

                Spacer()

                Button {
                    Task { await loadReviews() }
                } label: {
                    Image(systemName: "arrow.clockwise")
                        .font(.system(size: 11))
                }
                .buttonStyle(.plain)
                .foregroundColor(.secondary)
            }
            .padding(.horizontal, 16)
            .padding(.vertical, 10)

            Divider()

            if isLoading {
                ProgressView()
                    .frame(maxWidth: .infinity, maxHeight: .infinity)
            } else if reviews.isEmpty {
                VStack(spacing: 10) {
                    Image(systemName: "arrow.triangle.pull")
                        .font(.system(size: 28))
                        .foregroundColor(.secondary.opacity(0.5))
                    Text("No review requests")
                        .font(.system(size: 13, weight: .medium))
                        .foregroundColor(.secondary)
                    Text("Request code reviews from team members.")
                        .font(.system(size: 11))
                        .foregroundColor(.secondary.opacity(0.7))
                }
                .frame(maxWidth: .infinity, maxHeight: .infinity)
            } else {
                ScrollView {
                    LazyVStack(spacing: 16) {
                        if !pendingReviews.isEmpty {
                            reviewSection(title: "Pending", reviews: pendingReviews, color: .orange)
                        }
                        if !changesRequestedReviews.isEmpty {
                            reviewSection(title: "Changes Requested", reviews: changesRequestedReviews, color: .red)
                        }
                        if !approvedReviews.isEmpty {
                            reviewSection(title: "Approved", reviews: approvedReviews, color: .green)
                        }
                        if !dismissedReviews.isEmpty {
                            reviewSection(title: "Dismissed", reviews: dismissedReviews, color: .secondary)
                        }
                    }
                    .padding(12)
                }
            }
        }
        .task {
            await loadReviews()
        }
    }

    // MARK: - Section

    private func reviewSection(title: String, reviews: [ReviewRequest], color: Color) -> some View {
        VStack(alignment: .leading, spacing: 6) {
            HStack(spacing: 6) {
                Circle()
                    .fill(color)
                    .frame(width: 8, height: 8)
                Text(title)
                    .font(.system(size: 11, weight: .semibold))
                    .foregroundColor(.secondary)
                Text("\(reviews.count)")
                    .font(.system(size: 10, weight: .medium))
                    .foregroundColor(.secondary.opacity(0.7))
            }
            .padding(.horizontal, 4)

            ForEach(reviews) { review in
                ReviewRequestCard(review: review) { status in
                    resolveReview(review, status: status)
                }
            }
        }
    }

    // MARK: - Actions

    private func loadReviews() async {
        guard let projectId = appState.currentProject?.id else { return }
        isLoading = true
        do {
            reviews = try await premiumService.listReviewRequests(projectId: projectId)
        } catch {
            print("Reviews: failed to load: \(error)")
        }
        isLoading = false
    }

    private func resolveReview(_ review: ReviewRequest, status: String) {
        Task {
            do {
                let updated = try await premiumService.resolveReview(reviewId: review.id, status: status)
                if let index = reviews.firstIndex(where: { $0.id == updated.id }) {
                    reviews[index] = updated
                }
            } catch {
                print("Reviews: failed to resolve: \(error)")
            }
        }
    }
}

// MARK: - Review Request Card

struct ReviewRequestCard: View {
    let review: ReviewRequest
    let onResolve: (String) -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            // Requester -> Assignee
            HStack(spacing: 6) {
                UserInitials(userId: review.requestedBy)
                Image(systemName: "arrow.right")
                    .font(.system(size: 9))
                    .foregroundColor(.secondary)
                UserInitials(userId: review.assignedTo)

                Spacer()

                statusBadge
            }

            // Task reference
            HStack(spacing: 4) {
                Image(systemName: "checklist")
                    .font(.system(size: 10))
                    .foregroundColor(.secondary)
                Text("Task: \(review.taskId)")
                    .font(.system(size: 11))
                    .foregroundColor(.secondary)
                    .lineLimit(1)
            }

            // Comment
            if let comment = review.comment, !comment.isEmpty {
                Text(comment)
                    .font(.system(size: 12))
                    .foregroundColor(.primary)
                    .lineLimit(3)
                    .padding(8)
                    .background(
                        RoundedRectangle(cornerRadius: 6)
                            .fill(Color(nsColor: .windowBackgroundColor))
                    )
            }

            // Action buttons (only for pending reviews)
            if review.status == "pending" {
                HStack(spacing: 8) {
                    Spacer()

                    Button("Dismiss") {
                        onResolve("dismissed")
                    }
                    .font(.system(size: 11))
                    .foregroundColor(.secondary)
                    .buttonStyle(.plain)

                    Button("Request Changes") {
                        onResolve("changes_requested")
                    }
                    .font(.system(size: 11, weight: .medium))
                    .foregroundColor(.orange)
                    .buttonStyle(.plain)

                    Button {
                        onResolve("approved")
                    } label: {
                        HStack(spacing: 4) {
                            Image(systemName: "checkmark")
                                .font(.system(size: 10, weight: .bold))
                            Text("Approve")
                                .font(.system(size: 11, weight: .semibold))
                        }
                        .padding(.horizontal, 10)
                        .padding(.vertical, 4)
                        .background(
                            RoundedRectangle(cornerRadius: 5)
                                .fill(Color.green.opacity(0.15))
                        )
                        .foregroundColor(.green)
                    }
                    .buttonStyle(.plain)
                }
            }
        }
        .padding(12)
        .background(
            RoundedRectangle(cornerRadius: 8)
                .fill(Color(nsColor: .controlBackgroundColor))
                .overlay(
                    RoundedRectangle(cornerRadius: 8)
                        .stroke(Color(nsColor: .separatorColor).opacity(0.3), lineWidth: 0.5)
                )
        )
    }

    private var statusBadge: some View {
        let (label, color) = statusInfo(review.status)
        return Text(label)
            .font(.system(size: 9, weight: .bold))
            .foregroundColor(color)
            .padding(.horizontal, 6)
            .padding(.vertical, 2)
            .background(
                Capsule().fill(color.opacity(0.12))
            )
    }

    private func statusInfo(_ status: String) -> (String, Color) {
        switch status {
        case "pending": return ("PENDING", .orange)
        case "approved": return ("APPROVED", .green)
        case "changes_requested": return ("CHANGES REQUESTED", .red)
        case "dismissed": return ("DISMISSED", .secondary)
        default: return (status.uppercased(), .secondary)
        }
    }
}

// MARK: - User Initials

struct UserInitials: View {
    let userId: String

    var body: some View {
        let initials = String(userId.prefix(2).uppercased())
        Text(initials)
            .font(.system(size: 9, weight: .bold))
            .foregroundColor(.white)
            .frame(width: 22, height: 22)
            .background(
                Circle().fill(colorForUser(userId))
            )
    }

    private func colorForUser(_ id: String) -> Color {
        let hash = abs(id.hashValue)
        let colors: [Color] = [.blue, .purple, .orange, .green, .pink, .cyan, .indigo, .mint]
        return colors[hash % colors.count]
    }
}
