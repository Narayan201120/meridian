from datetime import datetime, timedelta, timezone

from app.services.scheduling import find_free_slots


def test_find_free_slots_empty_busy():
    time_min = datetime(2026, 8, 24, 9, 0, tzinfo=timezone.utc)
    time_max = datetime(2026, 8, 24, 18, 0, tzinfo=timezone.utc)
    slots = find_free_slots(busy=[], time_min=time_min, time_max=time_max, duration=timedelta(minutes=60), max_results=3)
    assert len(slots) == 3
    assert slots[0] == (datetime(2026, 8, 24, 9, 0, tzinfo=timezone.utc), datetime(2026, 8, 24, 10, 0, tzinfo=timezone.utc))
    assert slots[1][0] == datetime(2026, 8, 24, 9, 15, tzinfo=timezone.utc)


def test_find_free_slots_respects_busy():
    time_min = datetime(2026, 8, 24, 9, 0, tzinfo=timezone.utc)
    time_max = datetime(2026, 8, 24, 12, 0, tzinfo=timezone.utc)
    busy = [(datetime(2026, 8, 24, 9, 30, tzinfo=timezone.utc), datetime(2026, 8, 24, 10, 30, tzinfo=timezone.utc))]
    slots = find_free_slots(busy=busy, time_min=time_min, time_max=time_max, duration=timedelta(minutes=30), max_results=5)
    # First slot 9:00-9:30 should fit before busy
    assert slots[0] == (datetime(2026, 8, 24, 9, 0, tzinfo=timezone.utc), datetime(2026, 8, 24, 9, 30, tzinfo=timezone.utc))
    # Next should be after busy
    assert slots[1] == (datetime(2026, 8, 24, 10, 30, tzinfo=timezone.utc), datetime(2026, 8, 24, 11, 0, tzinfo=timezone.utc))


def test_find_free_slots_enforces_work_hours():
    time_min = datetime(2026, 8, 24, 7, 0, tzinfo=timezone.utc)
    time_max = datetime(2026, 8, 24, 20, 0, tzinfo=timezone.utc)
    slots = find_free_slots(busy=[], time_min=time_min, time_max=time_max, duration=timedelta(minutes=60), max_results=2)
    # Should not schedule before 9
    assert slots[0][0].hour == 9
    assert slots[0][0].minute == 0


def test_find_free_slots_merges_overlapping():
    time_min = datetime(2026, 8, 24, 9, 0, tzinfo=timezone.utc)
    time_max = datetime(2026, 8, 24, 12, 0, tzinfo=timezone.utc)
    busy = [
        (datetime(2026, 8, 24, 9, 0, tzinfo=timezone.utc), datetime(2026, 8, 24, 10, 0, tzinfo=timezone.utc)),
        (datetime(2026, 8, 24, 9, 30, tzinfo=timezone.utc), datetime(2026, 8, 24, 11, 0, tzinfo=timezone.utc)),
    ]
    slots = find_free_slots(busy=busy, time_min=time_min, time_max=time_max, duration=timedelta(minutes=30), max_results=2)
    assert slots[0] == (datetime(2026, 8, 24, 11, 0, tzinfo=timezone.utc), datetime(2026, 8, 24, 11, 30, tzinfo=timezone.utc))
