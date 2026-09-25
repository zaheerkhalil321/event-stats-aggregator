import fs from 'fs';
import path from 'path';

const HYROX_HERO_ROOT = path.resolve('../HyroxHeroMobile');
const screenPath = path.join(HYROX_HERO_ROOT, 'src/screens/main/HyroxEventsScreen.tsx');

const content = `import React, { useState, useEffect, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  TouchableOpacity,
  TextInput,
  ActivityIndicator,
  RefreshControl,
  Alert,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useNavigation } from '@react-navigation/native';
import { useTranslate } from '@tolgee/react';
import * as Sentry from '@sentry/react-native';
import { Colors, Spacing, FontSizes, BorderRadius } from '../../constants/theme';
import {
  fetchUpcomingEvents,
  fetchCompletedEvents,
  fetchEventDetails,
  formatHyroxEventDate,
  getWeeksUntilDate,
  HyroxEvent,
  EventDetails,
} from '../../services/eventsApi';
import { getCurrentUser } from '../../services/supabase';
import { updateUserProfile } from '../../services/users';

export const HyroxEventsScreen = () => {
  const { t } = useTranslate();
  const insets = useSafeAreaInsets();
  const navigation = useNavigation();

  const [activeTab, setActiveTab] = useState<'upcoming' | 'completed'>('upcoming');
  const [searchQuery, setSearchQuery] = useState('');
  const [upcomingEvents, setUpcomingEvents] = useState<HyroxEvent[]>([]);
  const [completedEvents, setCompletedEvents] = useState<HyroxEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [settingRaceId, setSettingRaceId] = useState<string | null>(null);
  const [expandedEventId, setExpandedEventId] = useState<string | null>(null);
  const [eventDetailsMap, setEventDetailsMap] = useState<Record<string, EventDetails>>({});
  const [loadingDetailsId, setLoadingDetailsId] = useState<string | null>(null);

  const loadData = useCallback(async (isRefresh = false) => {
    if (isRefresh) setRefreshing(true);
    else setLoading(true);

    try {
      if (activeTab === 'upcoming') {
        const events = await fetchUpcomingEvents(searchQuery);
        setUpcomingEvents(events);
      } else {
        const events = await fetchCompletedEvents(searchQuery);
        setCompletedEvents(events);
      }
    } catch (error) {
      console.error('[HyroxEventsScreen] Error loading events:', error);
      Sentry.withScope((scope) => {
        scope.setTag('feature', 'hyrox_events_screen');
        scope.setExtra('activeTab', activeTab);
        Sentry.captureException(error);
      });
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [activeTab, searchQuery]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  // Debounced search handling
  useEffect(() => {
    const timer = setTimeout(() => {
      loadData();
    }, 300);
    return () => clearTimeout(timer);
  }, [searchQuery]);

  const handleSelectAsTargetRace = async (event: HyroxEvent) => {
    try {
      const user = await getCurrentUser();
      if (!user) {
        Alert.alert(
          t('common.error', 'Error'),
          t('hyroxEvents.loginRequired', 'Please sign in to set your target race.')
        );
        return;
      }

      Alert.alert(
        t('hyroxEvents.confirmRaceTitle', 'Set Target Race?'),
        t('hyroxEvents.confirmRaceMessage', 'Set {raceName} ({date}) as your target HYROX race? Your training plan will sync to this timeline.', {
          raceName: event.name,
          date: formatHyroxEventDate(event.date),
        }),
        [
          { text: t('common.cancel', 'Cancel'), style: 'cancel' },
          {
            text: t('common.confirm', 'Confirm'),
            onPress: async () => {
              setSettingRaceId(event.id);
              const { error } = await updateUserProfile(user.id, {
                race_date: event.date,
                race_event_id: event.id,
                race_event_name: event.name,
              });

              setSettingRaceId(null);
              if (error) {
                Alert.alert(
                  t('common.error', 'Error'),
                  t('hyroxEvents.updateFailed', 'Could not update your race. Please try again.')
                );
              } else {
                Alert.alert(
                  t('hyroxEvents.successTitle', 'Target Race Updated! 🏆'),
                  t('hyroxEvents.successMessage', 'Your race is set to {raceName}. Keep up the great training!', {
                    raceName: event.name,
                  }),
                  [
                    {
                      text: t('common.ok', 'OK'),
                      onPress: () => navigation.goBack(),
                    },
                  ]
                );
              }
            },
          },
        ]
      );
    } catch (err) {
      setSettingRaceId(null);
      console.error('[HyroxEventsScreen] handleSelectAsTargetRace error:', err);
      Sentry.captureException(err);
    }
  };

  const handleToggleDetails = async (eventId: string) => {
    if (expandedEventId === eventId) {
      setExpandedEventId(null);
      return;
    }

    setExpandedEventId(eventId);
    if (!eventDetailsMap[eventId]) {
      setLoadingDetailsId(eventId);
      const details = await fetchEventDetails(eventId);
      if (details) {
        setEventDetailsMap((prev) => ({ ...prev, [eventId]: details }));
      }
      setLoadingDetailsId(null);
    }
  };

  const renderUpcomingCard = ({ item }: { item: HyroxEvent }) => {
    const weeksUntil = getWeeksUntilDate(item.date);
    const isSetting = settingRaceId === item.id;

    return (
      <View style={styles.card}>
        <View style={styles.cardHeader}>
          <View style={styles.dateBadge}>
            <Text style={styles.dateBadgeMonth}>
              {new Date(item.date + 'T00:00:00').toLocaleDateString('en-US', { month: 'short' }).toUpperCase()}
            </Text>
            <Text style={styles.dateBadgeDay}>
              {new Date(item.date + 'T00:00:00').getDate()}
            </Text>
          </View>
          <View style={styles.headerInfo}>
            <Text style={styles.eventName} numberOfLines={2}>
              {item.name}
            </Text>
            <View style={styles.locationRow}>
              <Ionicons name="location-outline" size={14} color={Colors.electricYellow} />
              <Text style={styles.locationText}>
                {item.city}, {item.country}
              </Text>
            </View>
          </View>
        </View>

        <View style={styles.cardFooter}>
          <View style={styles.metaRow}>
            <View style={styles.tag}>
              <Text style={styles.tagText}>
                {weeksUntil > 0
                  ? t('hyroxEvents.weeksToGo', '{weeks}w to go', { weeks: weeksUntil })
                  : t('hyroxEvents.soon', 'Soon')}
              </Text>
            </View>
            <View style={[styles.tag, styles.seasonTag]}>
              <Text style={styles.seasonTagText}>{item.season}</Text>
            </View>
          </View>

          <TouchableOpacity
            style={[styles.selectButton, isSetting && styles.buttonDisabled]}
            disabled={isSetting}
            onPress={() => handleSelectAsTargetRace(item)}
            activeOpacity={0.7}
          >
            {isSetting ? (
              <ActivityIndicator size="small" color={Colors.jetBlack} />
            ) : (
              <Text style={styles.selectButtonText}>
                {t('hyroxEvents.setAsMyRace', 'Set as My Race')}
              </Text>
            )}
          </TouchableOpacity>
        </View>
      </View>
    );
  };

  const renderCompletedCard = ({ item }: { item: HyroxEvent }) => {
    const isExpanded = expandedEventId === item.id;
    const isLoadingDetails = loadingDetailsId === item.id;
    const details = eventDetailsMap[item.id];

    return (
      <View style={styles.card}>
        <View style={styles.cardHeader}>
          <View style={[styles.dateBadge, styles.completedDateBadge]}>
            <Text style={styles.dateBadgeMonth}>
              {new Date(item.date + 'T00:00:00').toLocaleDateString('en-US', { month: 'short' }).toUpperCase()}
            </Text>
            <Text style={styles.dateBadgeDay}>
              {new Date(item.date + 'T00:00:00').getDate()}
            </Text>
          </View>
          <View style={styles.headerInfo}>
            <Text style={styles.eventName} numberOfLines={2}>
              {item.name}
            </Text>
            <View style={styles.locationRow}>
              <Ionicons name="location-outline" size={14} color={Colors.textSecondary} />
              <Text style={styles.locationText}>
                {item.city}, {item.country}
              </Text>
            </View>
          </View>
        </View>

        <View style={styles.cardFooter}>
          <View style={styles.metaRow}>
            {item.athletes_count > 0 && (
              <View style={[styles.tag, styles.athleteCountTag]}>
                <Ionicons name="people-outline" size={13} color={Colors.neonGreen} style={{ marginRight: 4 }} />
                <Text style={styles.athleteCountText}>
                  {item.athletes_count.toLocaleString()} {t('hyroxEvents.finishers', 'finishers')}
                </Text>
              </View>
            )}
            <View style={[styles.tag, styles.seasonTag]}>
              <Text style={styles.seasonTagText}>{item.season}</Text>
            </View>
          </View>

          <TouchableOpacity
            style={styles.detailsButton}
            onPress={() => handleToggleDetails(item.id)}
            activeOpacity={0.7}
          >
            <Text style={styles.detailsButtonText}>
              {isExpanded
                ? t('hyroxEvents.hideDetails', 'Hide')
                : t('hyroxEvents.viewDivisions', 'Divisions')}
            </Text>
            <Ionicons
              name={isExpanded ? 'chevron-up' : 'chevron-down'}
              size={14}
              color={Colors.electricYellow}
              style={{ marginLeft: 4 }}
            />
          </TouchableOpacity>
        </View>

        {isExpanded && (
          <View style={styles.detailsContainer}>
            {isLoadingDetails ? (
              <ActivityIndicator size="small" color={Colors.electricYellow} style={{ padding: Spacing.md }} />
            ) : details?.division_breakdown && details.division_breakdown.length > 0 ? (
              <View style={styles.divisionsList}>
                <Text style={styles.divisionHeaderTitle}>
                  {t('hyroxEvents.divisionBreakdown', 'Division Breakdown')}
                </Text>
                {details.division_breakdown.map((div, idx) => (
                  <View key={idx} style={styles.divisionRow}>
                    <Text style={styles.divisionNameText}>{div.division}</Text>
                    <Text style={styles.divisionCountText}>
                      {div.athletes_count.toLocaleString()} {t('hyroxEvents.athletes', 'athletes')}
                    </Text>
                  </View>
                ))}
              </View>
            ) : (
              <Text style={styles.noDetailsText}>
                {t('hyroxEvents.noDivisionData', 'No division breakdown available.')}
              </Text>
            )}
          </View>
        )}
      </View>
    );
  };

  const currentList = activeTab === 'upcoming' ? upcomingEvents : completedEvents;

  return (
    <View style={[styles.container, { paddingTop: insets.top + 16 }]}>
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity
          style={styles.backButton}
          onPress={() => navigation.goBack()}
          hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
        >
          <Ionicons name="arrow-back" size={24} color={Colors.pureWhite} />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>
          {t('hyroxEvents.screenTitle', 'HYROX Events')}
        </Text>
        <View style={{ width: 24 }} />
      </View>

      {/* Tabs */}
      <View style={styles.tabContainer}>
        <TouchableOpacity
          style={[styles.tabButton, activeTab === 'upcoming' && styles.tabButtonActive]}
          onPress={() => setActiveTab('upcoming')}
          activeOpacity={0.8}
        >
          <Text style={[styles.tabText, activeTab === 'upcoming' && styles.tabTextActive]}>
            {t('hyroxEvents.upcomingTab', 'Upcoming Races')}
          </Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.tabButton, activeTab === 'completed' && styles.tabButtonActive]}
          onPress={() => setActiveTab('completed')}
          activeOpacity={0.8}
        >
          <Text style={[styles.tabText, activeTab === 'completed' && styles.tabTextActive]}>
            {t('hyroxEvents.completedTab', 'Past Results')}
          </Text>
        </TouchableOpacity>
      </View>

      {/* Search Input */}
      <View style={styles.searchContainer}>
        <Ionicons name="search" size={18} color={Colors.textSecondary} style={{ marginRight: 8 }} />
        <TextInput
          style={styles.searchInput}
          placeholder={t('hyroxEvents.searchPlaceholder', 'Search city or race name...')}
          placeholderTextColor={Colors.zinc500}
          value={searchQuery}
          onChangeText={setSearchQuery}
          clearButtonMode="while-editing"
          autoCapitalize="none"
          autoCorrect={false}
        />
        {searchQuery.length > 0 && (
          <TouchableOpacity onPress={() => setSearchQuery('')}>
            <Ionicons name="close-circle" size={18} color={Colors.zinc500} />
          </TouchableOpacity>
        )}
      </View>

      {/* Events List */}
      {loading ? (
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" color={Colors.electricYellow} />
          <Text style={styles.loadingText}>
            {t('hyroxEvents.loading', 'Loading HYROX events...')}
          </Text>
        </View>
      ) : (
        <FlatList
          data={currentList}
          keyExtractor={(item) => item.id}
          renderItem={activeTab === 'upcoming' ? renderUpcomingCard : renderCompletedCard}
          contentContainerStyle={[styles.listContent, { paddingBottom: insets.bottom + 24 }]}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={() => loadData(true)}
              tintColor={Colors.electricYellow}
            />
          }
          ListEmptyComponent={
            <View style={styles.emptyContainer}>
              <Ionicons name="calendar-outline" size={48} color={Colors.zinc600} />
              <Text style={styles.emptyTitle}>
                {t('hyroxEvents.noEventsTitle', 'No events found')}
              </Text>
              <Text style={styles.emptySubtitle}>
                {searchQuery
                  ? t('hyroxEvents.tryDifferentSearch', 'Try searching for a different city or location')
                  : t('hyroxEvents.noEventsSubtitle', 'No races currently available for this section.')}
              </Text>
            </View>
          }
        />
      )}
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: Colors.background,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: Spacing.md,
    marginBottom: Spacing.md,
  },
  backButton: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: Colors.zinc800,
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerTitle: {
    fontSize: FontSizes.xl,
    fontWeight: '700',
    color: Colors.pureWhite,
  },
  tabContainer: {
    flexDirection: 'row',
    backgroundColor: Colors.zinc900,
    marginHorizontal: Spacing.md,
    marginBottom: Spacing.md,
    borderRadius: BorderRadius.lg,
    padding: 4,
    borderWidth: 1,
    borderColor: Colors.zinc800,
  },
  tabButton: {
    flex: 1,
    paddingVertical: Spacing.sm + 2,
    alignItems: 'center',
    borderRadius: BorderRadius.md,
  },
  tabButtonActive: {
    backgroundColor: Colors.zinc800,
  },
  tabText: {
    fontSize: FontSizes.sm,
    fontWeight: '600',
    color: Colors.zinc400,
  },
  tabTextActive: {
    color: Colors.electricYellow,
  },
  searchContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: Colors.zinc800,
    marginHorizontal: Spacing.md,
    marginBottom: Spacing.md,
    paddingHorizontal: Spacing.md,
    height: 44,
    borderRadius: BorderRadius.lg,
    borderWidth: 1,
    borderColor: Colors.zinc700,
  },
  searchInput: {
    flex: 1,
    color: Colors.pureWhite,
    fontSize: FontSizes.sm,
  },
  loadingContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  loadingText: {
    marginTop: Spacing.md,
    color: Colors.textSecondary,
    fontSize: FontSizes.sm,
  },
  listContent: {
    paddingHorizontal: Spacing.md,
  },
  card: {
    backgroundColor: Colors.zinc800,
    borderRadius: BorderRadius.lg,
    padding: Spacing.md,
    marginBottom: Spacing.md,
    borderWidth: 1,
    borderColor: Colors.zinc700,
  },
  cardHeader: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    marginBottom: Spacing.sm,
  },
  dateBadge: {
    width: 52,
    height: 52,
    borderRadius: BorderRadius.md,
    backgroundColor: Colors.electricYellow,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: Spacing.md,
  },
  completedDateBadge: {
    backgroundColor: Colors.zinc700,
  },
  dateBadgeMonth: {
    fontSize: 10,
    fontWeight: '800',
    color: Colors.jetBlack,
    letterSpacing: 0.5,
  },
  dateBadgeDay: {
    fontSize: 18,
    fontWeight: '800',
    color: Colors.jetBlack,
  },
  headerInfo: {
    flex: 1,
  },
  eventName: {
    fontSize: FontSizes.md,
    fontWeight: '700',
    color: Colors.pureWhite,
    marginBottom: 4,
  },
  locationRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  locationText: {
    fontSize: FontSizes.xs,
    color: Colors.textSecondary,
    marginLeft: 4,
  },
  cardFooter: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingTop: Spacing.sm,
    borderTopWidth: 1,
    borderTopColor: Colors.zinc700,
  },
  metaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  tag: {
    backgroundColor: Colors.zinc700,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: BorderRadius.xs,
  },
  tagText: {
    fontSize: 11,
    fontWeight: '600',
    color: Colors.electricYellow,
  },
  seasonTag: {
    backgroundColor: Colors.zinc900,
  },
  seasonTagText: {
    fontSize: 11,
    color: Colors.zinc400,
  },
  athleteCountTag: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(198, 255, 0, 0.1)',
    borderWidth: 1,
    borderColor: 'rgba(198, 255, 0, 0.2)',
  },
  athleteCountText: {
    fontSize: 11,
    color: Colors.neonGreen,
    fontWeight: '600',
  },
  selectButton: {
    backgroundColor: Colors.electricYellow,
    paddingHorizontal: Spacing.md,
    paddingVertical: 8,
    borderRadius: BorderRadius.md,
  },
  selectButtonText: {
    fontSize: FontSizes.xs,
    fontWeight: '700',
    color: Colors.jetBlack,
  },
  buttonDisabled: {
    opacity: 0.6,
  },
  detailsButton: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: Spacing.sm,
    paddingVertical: 6,
  },
  detailsButtonText: {
    fontSize: FontSizes.xs,
    fontWeight: '600',
    color: Colors.electricYellow,
  },
  detailsContainer: {
    marginTop: Spacing.sm,
    paddingTop: Spacing.sm,
    borderTopWidth: 1,
    borderTopColor: Colors.zinc700,
  },
  divisionsList: {
    gap: 6,
  },
  divisionHeaderTitle: {
    fontSize: 11,
    fontWeight: '700',
    color: Colors.textSecondary,
    textTransform: 'uppercase',
    marginBottom: 4,
  },
  divisionRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingVertical: 3,
  },
  divisionNameText: {
    fontSize: 12,
    color: Colors.pureWhite,
  },
  divisionCountText: {
    fontSize: 12,
    color: Colors.electricYellow,
    fontWeight: '600',
  },
  noDetailsText: {
    fontSize: 12,
    color: Colors.textSecondary,
    fontStyle: 'italic',
  },
  emptyContainer: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: Spacing.xxl,
  },
  emptyTitle: {
    fontSize: FontSizes.md,
    fontWeight: '700',
    color: Colors.pureWhite,
    marginTop: Spacing.md,
  },
  emptySubtitle: {
    fontSize: FontSizes.xs,
    color: Colors.textSecondary,
    textAlign: 'center',
    marginTop: 4,
    paddingHorizontal: Spacing.xl,
  },
});
`;

fs.writeFileSync(screenPath, content, 'utf8');
console.log('✅ Created src/screens/main/HyroxEventsScreen.tsx');
