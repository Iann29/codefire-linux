import { serve } from 'https://deno.land/std@0.177.0/http/server.ts'
import Stripe from 'https://esm.sh/stripe@14.21.0?target=deno'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.0'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, stripe-signature',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

/** Compute plan limits based on plan tier and extra seats purchased. */
function computePlanLimits(plan: string, extraSeats: number) {
  if (plan === 'agency') {
    return {
      plan: 'agency',
      seat_limit: 1 + extraSeats,
      project_limit: null, // unlimited
    }
  }
  // starter
  const totalSeats = 2 + extraSeats
  return {
    plan: 'starter',
    seat_limit: Math.min(totalSeats, 5), // max 5 for starter
    project_limit: 5,
  }
}

/** Extract extra seat quantity from subscription items. */
function getExtraSeatsFromSubscription(subscription: Stripe.Subscription): number {
  const extraSeatPrices = [
    'price_1T854NIxSwQrUVKogKg4kRqy', // starter extra seat
    'price_1T854XIxSwQrUVKo9ot5Ruls', // agency extra seat
  ]

  for (const item of subscription.items.data) {
    if (extraSeatPrices.includes(item.price.id)) {
      return item.quantity ?? 0
    }
  }
  return 0
}

serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    const stripe = new Stripe(Deno.env.get('STRIPE_SECRET_KEY')!, {
      apiVersion: '2024-06-20',
      httpClient: Stripe.createFetchHttpClient(),
    })

    const supabaseAdmin = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    )

    // Verify Stripe signature
    const signature = req.headers.get('stripe-signature')
    if (!signature) {
      return new Response(JSON.stringify({ error: 'Missing stripe-signature header' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    const body = await req.text()
    const webhookSecret = Deno.env.get('STRIPE_WEBHOOK_SECRET')!

    let event: Stripe.Event
    try {
      event = await stripe.webhooks.constructEventAsync(
        body,
        signature,
        webhookSecret,
      )
    } catch (err) {
      console.error('Webhook signature verification failed:', err.message)
      return new Response(JSON.stringify({ error: 'Invalid signature' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    console.log(`Received Stripe event: ${event.type} (${event.id})`)

    switch (event.type) {
      case 'checkout.session.completed': {
        const session = event.data.object as Stripe.Checkout.Session
        const teamId = session.metadata?.teamId
        const plan = session.metadata?.plan

        if (!teamId || !plan) {
          console.error('checkout.session.completed missing metadata:', session.metadata)
          break
        }

        // Retrieve the full subscription to get line item quantities
        const subscriptionId = session.subscription as string
        const subscription = await stripe.subscriptions.retrieve(subscriptionId)
        const extraSeats = getExtraSeatsFromSubscription(subscription)
        const limits = computePlanLimits(plan, extraSeats)

        const { error: updateError } = await supabaseAdmin
          .from('teams')
          .update({
            stripe_subscription_id: subscriptionId,
            ...limits,
          })
          .eq('id', teamId)

        if (updateError) {
          console.error('Failed to update team after checkout:', updateError)
        } else {
          console.log(`Team ${teamId} activated: plan=${limits.plan}, seats=${limits.seat_limit}, projects=${limits.project_limit}`)
        }
        break
      }

      case 'invoice.paid': {
        const invoice = event.data.object as Stripe.Invoice
        const subscriptionId = invoice.subscription as string

        if (!subscriptionId) break

        // Look up team by subscription ID to confirm it's active
        const { data: team } = await supabaseAdmin
          .from('teams')
          .select('id, plan')
          .eq('stripe_subscription_id', subscriptionId)
          .single()

        if (team) {
          console.log(`Invoice paid for team ${team.id} (plan: ${team.plan})`)
        }
        // No-op if already active — subscription stays as-is
        break
      }

      case 'invoice.payment_failed': {
        const invoice = event.data.object as Stripe.Invoice
        const subscriptionId = invoice.subscription as string

        if (!subscriptionId) break

        const { data: team } = await supabaseAdmin
          .from('teams')
          .select('id, name')
          .eq('stripe_subscription_id', subscriptionId)
          .single()

        if (team) {
          console.warn(`Payment failed for team ${team.id} (${team.name}). Grace period — no action taken.`)
        }
        break
      }

      case 'customer.subscription.updated': {
        const subscription = event.data.object as Stripe.Subscription
        const teamId = subscription.metadata?.teamId
        const plan = subscription.metadata?.plan

        if (!teamId || !plan) {
          // Try to find team by subscription ID
          const { data: team } = await supabaseAdmin
            .from('teams')
            .select('id, plan')
            .eq('stripe_subscription_id', subscription.id)
            .single()

          if (team) {
            const extraSeats = getExtraSeatsFromSubscription(subscription)
            const limits = computePlanLimits(team.plan, extraSeats)

            await supabaseAdmin
              .from('teams')
              .update({ seat_limit: limits.seat_limit, project_limit: limits.project_limit })
              .eq('id', team.id)

            console.log(`Team ${team.id} subscription updated: seats=${limits.seat_limit}`)
          }
          break
        }

        const extraSeats = getExtraSeatsFromSubscription(subscription)
        const limits = computePlanLimits(plan, extraSeats)

        const { error: updateError } = await supabaseAdmin
          .from('teams')
          .update({
            ...limits,
          })
          .eq('id', teamId)

        if (updateError) {
          console.error('Failed to update team on subscription change:', updateError)
        } else {
          console.log(`Team ${teamId} subscription updated: plan=${limits.plan}, seats=${limits.seat_limit}`)
        }
        break
      }

      case 'customer.subscription.deleted': {
        const subscription = event.data.object as Stripe.Subscription
        const teamId = subscription.metadata?.teamId

        // Find team by subscription ID as fallback
        const query = teamId
          ? supabaseAdmin.from('teams').select('id').eq('id', teamId).single()
          : supabaseAdmin.from('teams').select('id').eq('stripe_subscription_id', subscription.id).single()

        const { data: team } = await query

        if (team) {
          const { error: updateError } = await supabaseAdmin
            .from('teams')
            .update({
              plan: 'starter',
              seat_limit: 2,
              project_limit: 5,
              stripe_subscription_id: null,
            })
            .eq('id', team.id)

          if (updateError) {
            console.error('Failed to reset team on subscription deletion:', updateError)
          } else {
            console.log(`Team ${team.id} reset to free tier after subscription cancellation`)
          }
        }
        break
      }

      default:
        console.log(`Unhandled event type: ${event.type}`)
    }

    return new Response(JSON.stringify({ received: true }), {
      status: 200,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  } catch (err) {
    console.error('stripe-webhook error:', err)
    return new Response(JSON.stringify({ error: err.message || 'Internal server error' }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }
})
