import { serve } from 'https://deno.land/std@0.177.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.0'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    // This function is called via Supabase database webhook
    // when a new synced_task_note with mentions is inserted
    const { record } = await req.json()

    if (!record.mentions || record.mentions.length === 0) {
      return new Response('ok', { headers: corsHeaders })
    }

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    )

    // Get the task to find the project
    const { data: task } = await supabase
      .from('synced_tasks')
      .select('id, title, project_id')
      .eq('id', record.task_id)
      .single()

    if (!task) {
      return new Response('task not found', {
        status: 404,
        headers: corsHeaders,
      })
    }

    // Get the author's display name
    const { data: author } = await supabase
      .from('users')
      .select('display_name')
      .eq('id', record.created_by)
      .single()

    const authorName = author?.display_name || 'Someone'

    // Create notifications for each mentioned user (skip self-mentions)
    const notifications = record.mentions
      .filter((userId: string) => userId !== record.created_by)
      .map((userId: string) => ({
        user_id: userId,
        project_id: task.project_id,
        type: 'mention',
        title: `${authorName} mentioned you`,
        body: `In task "${task.title}": ${record.content.substring(0, 100)}`,
        entity_type: 'task_note',
        entity_id: record.id,
      }))

    if (notifications.length > 0) {
      const { error } = await supabase.from('notifications').insert(notifications)
      if (error) {
        console.error('Failed to insert notifications:', error)
        return new Response(JSON.stringify({ error: error.message }), {
          status: 500,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        })
      }
    }

    return new Response('ok', { headers: corsHeaders })
  } catch (err) {
    console.error('handle-mention error:', err)
    return new Response(JSON.stringify({ error: err.message || 'Internal server error' }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }
})
