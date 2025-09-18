import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import supabase from '../supabase/SupabaseClient';

interface TimeRange {
  start: Date;
  end: Date;
  label: string;
}

interface ConversationMetrics {
  timestamp: string;
  conversationCount: number;
  activeUsers: number;
}

interface DashboardData {
  last24Hours: ConversationMetrics[];
  last7Days: ConversationMetrics[];
  last12Months: ConversationMetrics[];
  activeUsersToday: number;
  activeUsersWeek: number;
  activeUsersMonth: number;
}

const getTimeRanges = () => {
  const now = new Date();

  const last24Hours = new Date(now);
  last24Hours.setHours(now.getHours() - 24);

  const last7Days = new Date(now);
  last7Days.setDate(now.getDate() - 7);

  const last12Months = new Date(now);
  last12Months.setMonth(now.getMonth() - 12);

  return {
    last24Hours,
    last7Days,
    last12Months,
  };
};

const fetchConversationMetrics = async (
  startDate: Date,
  endDate: Date,
  groupBy: 'hour' | 'day' | 'month',
  channelId?: string
): Promise<ConversationMetrics[]> => {
  const startTs = Math.floor(startDate.getTime() / 1000);
  const endTs = Math.floor(endDate.getTime() / 1000);

  let query = supabase
    .from('slack_message')
    .select('ts_date, ts_time, user_id, thread_ts_date, channel_id')
    .gte('ts_date', startTs)
    .lte('ts_date', endTs);

  if (channelId) {
    query = query.eq('channel_id', channelId);
  }

  const { data, error } = await query;

  if (error) {
    console.error('Error fetching conversation metrics:', error);
    throw error;
  }

  // Group conversations by thread
  const conversationMap = new Map<string, Set<string>>();
  const userActivityMap = new Map<string, Set<string>>();

  data?.forEach((message) => {
    const threadKey = message.thread_ts_date
      ? `${message.thread_ts_date}-${message.thread_ts_time}`
      : `${message.ts_date}-${message.ts_time}`;

    const timestamp = new Date(message.ts_date * 1000);
    let periodKey: string;

    if (groupBy === 'hour') {
      periodKey = timestamp.toISOString().slice(0, 13) + ':00:00Z';
    } else if (groupBy === 'day') {
      periodKey = timestamp.toISOString().slice(0, 10);
    } else {
      periodKey = timestamp.toISOString().slice(0, 7);
    }

    if (!conversationMap.has(periodKey)) {
      conversationMap.set(periodKey, new Set());
      userActivityMap.set(periodKey, new Set());
    }

    conversationMap.get(periodKey)?.add(threadKey);
    userActivityMap.get(periodKey)?.add(message.user_id);
  });

  // Convert to array and sort
  const metrics: ConversationMetrics[] = Array.from(conversationMap.entries())
    .map(([timestamp, conversations]) => ({
      timestamp,
      conversationCount: conversations.size,
      activeUsers: userActivityMap.get(timestamp)?.size || 0,
    }))
    .sort((a, b) => a.timestamp.localeCompare(b.timestamp));

  return metrics;
};

export const useConversationMetrics = (channelId?: string) => {
  const queryClient = useQueryClient();
  const [isGlobalView, setIsGlobalView] = useState(true);

  const queryKey = ['conversationMetrics', isGlobalView ? 'global' : channelId];

  const { data, isLoading, error } = useQuery({
    queryKey,
    queryFn: async (): Promise<DashboardData> => {
      const ranges = getTimeRanges();
      const now = new Date();
      const targetChannel = isGlobalView ? undefined : channelId;

      const [last24Hours, last7Days, last12Months] = await Promise.all([
        fetchConversationMetrics(ranges.last24Hours, now, 'hour', targetChannel),
        fetchConversationMetrics(ranges.last7Days, now, 'day', targetChannel),
        fetchConversationMetrics(ranges.last12Months, now, 'month', targetChannel),
      ]);

      // Calculate active users for different periods
      const activeUsersToday = last24Hours.reduce((sum, m) => sum + m.activeUsers, 0);
      const activeUsersWeek = last7Days.reduce((sum, m) => sum + m.activeUsers, 0);
      const activeUsersMonth = last12Months
        .filter(m => new Date(m.timestamp) >= new Date(new Date().setMonth(new Date().getMonth() - 1)))
        .reduce((sum, m) => sum + m.activeUsers, 0);

      return {
        last24Hours,
        last7Days,
        last12Months,
        activeUsersToday,
        activeUsersWeek,
        activeUsersMonth,
      };
    },
    refetchInterval: 60000, // Refetch every minute
  });

  // Set up realtime subscription
  useEffect(() => {
    const channel = supabase
      .channel('dashboard-metrics')
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'slack_message',
        },
        () => {
          // Invalidate and refetch the query when new messages arrive
          queryClient.invalidateQueries({ queryKey });
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [queryClient, queryKey]);

  return {
    data,
    isLoading,
    error,
    isGlobalView,
    setIsGlobalView,
  };
};