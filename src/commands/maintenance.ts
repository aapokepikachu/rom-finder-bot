import { Context } from 'telegraf';
import { Setting, SETTING_KEYS } from '../models/Setting';
import { invalidateMaintenanceCache, isMaintenanceOn } from '../middleware/maintenance';

export async function maintenanceCommand(ctx: Context): Promise<void> {
  const on = await isMaintenanceOn();

  await ctx.reply(
    `🔧 <b>Maintenance Mode</b>\n\n` +
    `Current status: ${on ? '🔴 <b>ON</b> — users are blocked' : '🟢 <b>OFF</b> — bot is live'}\n\n` +
    (on
      ? 'Turn it <b>off</b> to restore access for all users.'
      : 'Turn it <b>on</b> to block all users while you run /backfill or make changes.\n<i>Admins are never blocked.</i>'),
    {
      parse_mode: 'HTML',
      reply_markup: {
        inline_keyboard: [[
          on
            ? { text: '🟢 Turn OFF (restore access)', callback_data: 'maintenance:off' }
            : { text: '🔴 Turn ON (block users)',     callback_data: 'maintenance:on'  },
        ]],
      },
    }
  );
}

export async function setMaintenance(
  ctx: Context,
  value: 'on' | 'off'
): Promise<void> {
  await ctx.answerCbQuery();

  await Setting.findOneAndUpdate(
    { key: SETTING_KEYS.MAINTENANCE },
    { $set: { value, updatedBy: ctx.from!.id } },
    { upsert: true }
  );

  invalidateMaintenanceCache();

  const isOn = value === 'on';

  await ctx.editMessageText(
    `🔧 <b>Maintenance Mode</b>\n\n` +
    `Status changed to: ${isOn ? '🔴 <b>ON</b>' : '🟢 <b>OFF</b>'}\n\n` +
    (isOn
      ? '✅ All user commands are now blocked.\nYou can safely run /backfill or make changes.\n\n<i>Admins can still use all commands.</i>'
      : '✅ Bot is now live. All users can search again.'),
    {
      parse_mode: 'HTML',
      reply_markup: {
        inline_keyboard: [[
          isOn
            ? { text: '🟢 Turn OFF', callback_data: 'maintenance:off' }
            : { text: '🔴 Turn ON',  callback_data: 'maintenance:on'  },
        ]],
      },
    }
  );
}
