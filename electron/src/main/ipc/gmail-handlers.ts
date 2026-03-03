import { ipcMain } from 'electron'
import type { GmailService } from '../services/GmailService'

export function registerGmailHandlers(gmailService: GmailService) {
  ipcMain.handle('gmail:listAccounts', () => {
    return gmailService.listAccounts()
  })

  ipcMain.handle('gmail:authenticate', async () => {
    return gmailService.authenticate()
  })

  ipcMain.handle('gmail:removeAccount', (_e, accountId: string) => {
    gmailService.removeAccount(accountId)
    return { success: true }
  })

  ipcMain.handle('gmail:listRules', () => {
    return gmailService.listWhitelistRules()
  })

  ipcMain.handle(
    'gmail:addRule',
    (
      _e,
      data: {
        pattern: string
        clientId?: string
        priority?: number
        note?: string
      }
    ) => {
      return gmailService.addWhitelistRule(data)
    }
  )

  ipcMain.handle('gmail:removeRule', (_e, ruleId: string) => {
    gmailService.removeWhitelistRule(ruleId)
    return { success: true }
  })

  ipcMain.handle('gmail:pollEmails', async (_e, accountId: string) => {
    return gmailService.pollEmails(accountId)
  })
}
