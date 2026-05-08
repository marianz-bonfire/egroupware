<?php
/**
 * Unit tests for recurrence exceptions through calendar BO (no CalDAV)
 *
 * @package calendar
 * @subpackage tests
 */

namespace EGroupware\calendar;

require_once realpath(__DIR__.'/../../api/tests/AppTest.php');

use EGroupware\Api;

class RecurrenceExceptionTest extends \EGroupware\Api\AppTest
{
	/**
	 * @var \calendar_boupdate
	 */
	protected $bo;

	/**
	 * @var int[]
	 */
	protected $event_ids = [];

	protected static $orig_date_tz;

	public static function setUpBeforeClass() : void
	{
		parent::setUpBeforeClass();
		self::$orig_date_tz = date_default_timezone_get();
	}

	public static function tearDownAfterClass() : void
	{
		date_default_timezone_set(self::$orig_date_tz);
		parent::tearDownAfterClass();
	}

	protected function setUp() : void
	{
		parent::setUp();
		$this->bo = new \calendar_boupdate();
		$this->setTimezones('UTC', 'UTC');
	}

	protected function tearDown() : void
	{
		foreach(array_unique($this->event_ids) as $id)
		{
			$this->bo->delete($id, 0, true);
			$this->bo->delete($id, 0, true);
		}
		parent::tearDown();
	}

	protected function setTimezones(string $client, string $server) : void
	{
		$GLOBALS['egw_info']['server']['server_timezone'] = $server;
		$GLOBALS['egw_info']['user']['preferences']['common']['tz'] = $client;
		date_default_timezone_set($server);
		Api\DateTime::init();
	}

	protected function createDailyRecurringEvent() : int
	{
		$start = new Api\DateTime('now');
		$start->modify('+1 day');
		$start->setTime(9, 0, 0);
		$end = clone $start;
		$end->modify('+1 hour');
		$recur_end = clone $start;
		$recur_end->modify('+7 days');
		$recur_end->setTime(0, 0, 0);

		$event = [
			'title' => 'Recurrence exception unit test '.uniqid(),
			'owner' => $GLOBALS['egw_info']['user']['account_id'],
			'start' => $start,
			'end' => $end,
			'tzid' => 'UTC',
			'recur_type' => MCAL_RECUR_DAILY,
			'recur_enddate' => $recur_end,
			'participants' => [
				$GLOBALS['egw_info']['user']['account_id'] => 'A',
			],
		];

		$id = $this->bo->save($event);
		$this->assertGreaterThan(0, $id, 'Recurring event could not be created');
		$this->event_ids[] = (int)$id;

		return (int)$id;
	}

	protected function recurrenceStarts(int $cal_id) : array
	{
		$so = new \calendar_so();
		$recurrences = $so->get_recurrences($cal_id);
		unset($recurrences[0]); // master row
		$starts = array_map('intval', array_keys($recurrences));
		sort($starts);
		return $starts;
	}

	protected function assertDateInList(array $dates, Api\DateTime $expected, string $message='') : void
	{
		$expected_ts = Api\DateTime::to($expected, 'ts');
		foreach($dates as $date)
		{
			if((int)Api\DateTime::to($date, 'ts') === (int)$expected_ts)
			{
				$this->assertTrue(true);
				return;
			}
		}
		$this->fail($message ?: 'Expected date not found in recurrence exception list');
	}

	public function testDeleteSingleInstanceAddsRecurrenceException()
	{
		$cal_id = $this->createDailyRecurringEvent();
		$before = $this->recurrenceStarts($cal_id);
		$this->assertGreaterThanOrEqual(3, count($before), 'Expected at least 3 generated recurrences');

		$recur_start_server = $before[1];
		$recur_start_user = new Api\DateTime(
			Api\DateTime::server2user($recur_start_server),
			Api\DateTime::$user_timezone
		);

		$this->assertTrue(
			$this->bo->delete($cal_id, $recur_start_user, true, true),
			'Deleting single recurrence failed'
		);

		$master = $this->bo->read($cal_id);
		$this->assertIsArray($master);
		$this->assertIsArray($master['recur_exception']);
		$this->assertDateInList(
			$master['recur_exception'],
			$recur_start_user,
			'Deleted instance start is not listed as recur_exception on master'
		);

		$after = $this->recurrenceStarts($cal_id);
		$this->assertCount(count($before) - 1, $after, 'Single recurrence delete should remove exactly one recurrence row');
		$this->assertNotContains($recur_start_server, $after, 'Deleted recurrence start is still present');
	}

	public function testRescheduleSingleInstanceCreatesExceptionEvent()
	{
		$cal_id = $this->createDailyRecurringEvent();
		$before = $this->recurrenceStarts($cal_id);
		$this->assertGreaterThanOrEqual(3, count($before), 'Expected at least 3 generated recurrences');

		$recur_start_server = $before[1];
		$recur_start_user = Api\DateTime::server2user($recur_start_server);
		$occurrence = $this->bo->read($cal_id, $recur_start_user);
		$this->assertIsArray($occurrence, 'Unable to read selected recurrence');

		$master = $this->bo->read($cal_id);
		$master['recur_exception'][] = clone $occurrence['start'];
		unset($master['start'], $master['end'], $master['alarm']);
		$this->assertNotFalse($this->bo->update($master, true), 'Unable to add recurrence exception to master');

		$duration = $occurrence['start']->diff($occurrence['end']);
		$expected_start = clone $occurrence['start'];
		$expected_start->modify('+2 hours');
		$expected_end = clone $expected_start;
		$expected_end->add($duration);

		$exception = $occurrence;
		unset($exception['id']);
		$exception['reference'] = $cal_id;
		$exception['recurrence'] = clone $occurrence['start'];
		$exception['start'] = clone $expected_start;
		$exception['end'] = clone $expected_end;
		$exception['recur_type'] = MCAL_RECUR_NONE;
		foreach(['recur_enddate', 'recur_interval', 'recur_exception', 'recur_data', 'recur_rdates'] as $name)
		{
			unset($exception[$name]);
		}

		$exception_id = $this->bo->save($exception, true);
		$this->assertGreaterThan(0, $exception_id, 'Exception event could not be created');
		$this->event_ids[] = (int)$exception_id;

		$loaded_exception = $this->bo->read((int)$exception_id);
		$this->assertIsArray($loaded_exception, 'Saved exception event could not be read');
		$this->assertEquals($cal_id, (int)$loaded_exception['reference'], 'Exception reference should point to master event');
		$this->assertEquals(
			(int)Api\DateTime::to($occurrence['start'], 'ts'),
			(int)Api\DateTime::to($loaded_exception['recurrence'], 'ts'),
			'Exception recurrence should match original occurrence start'
		);
		$this->assertEquals(
			(int)Api\DateTime::to($expected_start, 'ts'),
			(int)Api\DateTime::to($loaded_exception['start'], 'ts'),
			'Exception start is not rescheduled as expected'
		);
		$this->assertEquals(
			(int)Api\DateTime::to($expected_end, 'ts'),
			(int)Api\DateTime::to($loaded_exception['end'], 'ts'),
			'Exception end is not rescheduled as expected'
		);

		$after = $this->recurrenceStarts($cal_id);
		$this->assertCount(count($before) - 1, $after, 'Master recurrences should exclude the moved occurrence');
		$this->assertNotContains($recur_start_server, $after, 'Original recurrence still exists on master after reschedule');

		// Ensure other recurrence starts are unchanged (only the moved occurrence removed)
		$expected = $before;
		foreach ($expected as $k => $v) {
			if ($v === $recur_start_server) {
				unset($expected[$k]);
				break;
			}
		}
		$expected = array_values($expected);
		sort($expected);
		$sorted_after = $after;
		sort($sorted_after);
		$this->assertEquals($expected, $sorted_after, 'Other recurrence starts were unexpectedly changed');
	}
}
