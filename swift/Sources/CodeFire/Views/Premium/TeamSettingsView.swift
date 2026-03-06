import SwiftUI

struct TeamSettingsTab: View {
    @ObservedObject var settings: AppSettings
    @ObservedObject var premiumService = PremiumService.shared

    // Auth form
    @State private var authEmail: String = ""
    @State private var authPassword: String = ""
    @State private var authDisplayName: String = ""
    @State private var isSignUp = false
    @State private var authError: String?
    @State private var isAuthLoading = false

    // Team management
    @State private var members: [TeamMember] = []
    @State private var inviteEmail: String = ""
    @State private var inviteRole: String = "member"
    @State private var newTeamName: String = ""
    @State private var isCreatingTeam = false
    @State private var isInviting = false

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 20) {
                if !premiumService.status.enabled {
                    enableSection
                } else if !premiumService.status.authenticated {
                    authSection
                } else {
                    authenticatedSection
                }
            }
            .padding(16)
        }
    }

    // MARK: - Not Enabled

    private var enableSection: some View {
        GroupBox("Premium Teams") {
            VStack(alignment: .leading, spacing: 12) {
                Text("Enable collaborative features: shared activity feeds, session summaries, project docs, and code reviews with your team.")
                    .font(.system(size: 12))
                    .foregroundColor(.secondary)

                Text("Free during alpha. No credit card required to try.")
                    .font(.system(size: 11))
                    .foregroundStyle(.tertiary)

                Button("Enable Premium") {
                    settings.premiumEnabled = true
                    premiumService.status.enabled = true
                }
            }
            .padding(8)
        }
    }

    // MARK: - Not Authenticated

    private var authSection: some View {
        GroupBox(isSignUp ? "Create Account" : "Sign In") {
            VStack(alignment: .leading, spacing: 10) {
                if isSignUp {
                    TextField("Display Name", text: $authDisplayName)
                        .textFieldStyle(.roundedBorder)
                        .font(.system(size: 12))
                }

                TextField("Email", text: $authEmail)
                    .textFieldStyle(.roundedBorder)
                    .font(.system(size: 12))

                SecureField("Password", text: $authPassword)
                    .textFieldStyle(.roundedBorder)
                    .font(.system(size: 12))

                if let error = authError {
                    Text(error)
                        .font(.system(size: 11))
                        .foregroundColor(.red)
                }

                HStack {
                    Button(isSignUp ? "Sign Up" : "Sign In") {
                        performAuth()
                    }
                    .disabled(authEmail.isEmpty || authPassword.isEmpty || isAuthLoading)

                    if isAuthLoading {
                        ProgressView()
                            .controlSize(.small)
                            .scaleEffect(0.7)
                    }

                    Spacer()

                    Button(isSignUp ? "Already have an account" : "Create an account") {
                        isSignUp.toggle()
                        authError = nil
                    }
                    .font(.system(size: 11))
                    .foregroundColor(.accentColor)
                    .buttonStyle(.plain)
                }

                Divider()

                Button("Disable Premium") {
                    premiumService.status.enabled = false
                }
                .font(.system(size: 11))
                .foregroundColor(.secondary)
                .buttonStyle(.plain)
            }
            .padding(8)
        }
    }

    // MARK: - Authenticated + Team

    private var authenticatedSection: some View {
        VStack(alignment: .leading, spacing: 16) {
            // User info
            GroupBox("Account") {
                VStack(alignment: .leading, spacing: 8) {
                    if let user = premiumService.status.user {
                        HStack(spacing: 10) {
                            Text(user.displayName.prefix(2).uppercased())
                                .font(.system(size: 12, weight: .bold))
                                .foregroundColor(.white)
                                .frame(width: 32, height: 32)
                                .background(Circle().fill(Color.accentColor))

                            VStack(alignment: .leading, spacing: 2) {
                                Text(user.displayName)
                                    .font(.system(size: 13, weight: .medium))
                                Text(user.email)
                                    .font(.system(size: 11))
                                    .foregroundColor(.secondary)
                            }

                            Spacer()

                            Button("Sign Out") {
                                premiumService.signOut()
                            }
                            .font(.system(size: 11))
                            .foregroundColor(.red)
                        }
                    }
                }
                .padding(8)
            }

            // Team section
            if let team = premiumService.status.team {
                teamSection(team)
            } else {
                createTeamSection
            }
        }
    }

    // MARK: - Team Section

    private func teamSection(_ team: Team) -> some View {
        VStack(alignment: .leading, spacing: 16) {
            GroupBox("Team: \(team.name)") {
                VStack(alignment: .leading, spacing: 10) {
                    HStack {
                        Label(team.plan.capitalized, systemImage: "crown")
                            .font(.system(size: 11, weight: .medium))
                            .foregroundColor(.orange)

                        Spacer()

                        Text("\(members.count)/\(team.seatLimit) seats")
                            .font(.system(size: 11))
                            .foregroundColor(.secondary)
                    }

                    Divider()

                    // Member list
                    ForEach(members, id: \.userId) { member in
                        HStack(spacing: 8) {
                            if let user = member.user {
                                Text(user.displayName.prefix(2).uppercased())
                                    .font(.system(size: 9, weight: .bold))
                                    .foregroundColor(.white)
                                    .frame(width: 22, height: 22)
                                    .background(Circle().fill(Color.accentColor.opacity(0.8)))

                                VStack(alignment: .leading, spacing: 1) {
                                    Text(user.displayName)
                                        .font(.system(size: 12))
                                    Text(user.email)
                                        .font(.system(size: 10))
                                        .foregroundColor(.secondary)
                                }
                            } else {
                                Text("?")
                                    .font(.system(size: 9, weight: .bold))
                                    .foregroundColor(.white)
                                    .frame(width: 22, height: 22)
                                    .background(Circle().fill(Color.secondary))

                                Text(member.userId)
                                    .font(.system(size: 12))
                            }

                            Spacer()

                            Text(member.role)
                                .font(.system(size: 10, weight: .medium))
                                .foregroundColor(.secondary)
                                .padding(.horizontal, 6)
                                .padding(.vertical, 2)
                                .background(
                                    Capsule()
                                        .fill(Color(nsColor: .separatorColor).opacity(0.2))
                                )

                            if member.role != "owner" && team.ownerId == premiumService.status.user?.id {
                                Button {
                                    removeMember(member)
                                } label: {
                                    Image(systemName: "xmark")
                                        .font(.system(size: 9, weight: .bold))
                                        .foregroundColor(.secondary)
                                }
                                .buttonStyle(.plain)
                            }
                        }
                    }

                    Divider()

                    // Invite form
                    HStack(spacing: 6) {
                        TextField("Email to invite", text: $inviteEmail)
                            .textFieldStyle(.roundedBorder)
                            .font(.system(size: 12))

                        Picker("Role", selection: $inviteRole) {
                            Text("Member").tag("member")
                            Text("Admin").tag("admin")
                        }
                        .frame(width: 100)
                        .font(.system(size: 11))

                        Button("Invite") {
                            inviteMember()
                        }
                        .disabled(inviteEmail.trimmingCharacters(in: .whitespaces).isEmpty || isInviting)
                        .font(.system(size: 11))
                    }

                    // Billing
                    HStack {
                        Button("Manage Billing") {
                            openBilling(team)
                        }
                        .font(.system(size: 11))
                        .buttonStyle(.plain)
                        .foregroundColor(.accentColor)
                    }
                }
                .padding(8)
            }
        }
        .task {
            await loadMembers()
        }
    }

    // MARK: - Create Team

    private var createTeamSection: some View {
        GroupBox("Create a Team") {
            VStack(alignment: .leading, spacing: 10) {
                Text("Create a team to collaborate with others on projects.")
                    .font(.system(size: 12))
                    .foregroundColor(.secondary)

                TextField("Team Name", text: $newTeamName)
                    .textFieldStyle(.roundedBorder)
                    .font(.system(size: 12))

                HStack {
                    Button("Create Team") {
                        createTeam()
                    }
                    .disabled(newTeamName.trimmingCharacters(in: .whitespaces).isEmpty || isCreatingTeam)

                    if isCreatingTeam {
                        ProgressView()
                            .controlSize(.small)
                            .scaleEffect(0.7)
                    }
                }
            }
            .padding(8)
        }
    }

    // MARK: - Actions

    private func performAuth() {
        isAuthLoading = true
        authError = nil
        Task {
            do {
                if isSignUp {
                    try await premiumService.signUp(email: authEmail, password: authPassword, displayName: authDisplayName)
                } else {
                    try await premiumService.signIn(email: authEmail, password: authPassword)
                }
            } catch {
                authError = error.localizedDescription
            }
            isAuthLoading = false
        }
    }

    private func loadMembers() async {
        guard let team = premiumService.status.team else { return }
        do {
            members = try await premiumService.listMembers(teamId: team.id)
        } catch {
            print("TeamSettings: failed to load members: \(error)")
        }
    }

    private func inviteMember() {
        guard let team = premiumService.status.team else { return }
        isInviting = true
        Task {
            do {
                try await premiumService.inviteMember(teamId: team.id, email: inviteEmail, role: inviteRole)
                inviteEmail = ""
                await loadMembers()
            } catch {
                print("TeamSettings: failed to invite: \(error)")
            }
            isInviting = false
        }
    }

    private func removeMember(_ member: TeamMember) {
        guard let team = premiumService.status.team else { return }
        Task {
            do {
                try await premiumService.removeMember(teamId: team.id, userId: member.userId)
                await loadMembers()
            } catch {
                print("TeamSettings: failed to remove member: \(error)")
            }
        }
    }

    private func createTeam() {
        isCreatingTeam = true
        Task {
            do {
                let slug = newTeamName.lowercased()
                    .replacingOccurrences(of: " ", with: "-")
                    .filter { $0.isLetter || $0.isNumber || $0 == "-" }
                try await premiumService.createTeam(name: newTeamName, slug: slug)
                newTeamName = ""
            } catch {
                print("TeamSettings: failed to create team: \(error)")
            }
            isCreatingTeam = false
        }
    }

    private func openBilling(_ team: Team) {
        Task {
            do {
                let url = try await premiumService.getBillingPortal(teamId: team.id)
                NSWorkspace.shared.open(url)
            } catch {
                print("TeamSettings: failed to open billing: \(error)")
            }
        }
    }
}
