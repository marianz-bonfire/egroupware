<?php
/**
 * CalDAV tests: create, read and delete an event
 *
 * @link https://www.egroupware.org
 * @author Ralf Becker <rb@egroupware.org>
 * @package calendar
 * @subpackage tests
 * @copyright (c) 2020 by Ralf Becker <rb@egroupware.org>
 * @license http://opensource.org/licenses/gpl-license.php GPL - GNU General Public License
 */

namespace EGroupware\calendar;

require_once __DIR__.'/../../../api/tests/CalDAVTest.php';

use EGroupware\Api\CalDAVTest;
use GuzzleHttp\RequestOptions;
use PHPUnit\Framework\Attributes\Depends;

class CreateReadDeleteTest extends CalDAVTest
{
	protected const EVENT_UID = 'new-event-create-read-delete';
	protected static $event_uid;
	protected static $cal_ids = [];

	public static function setUpBeforeClass() : void
	{
		parent::setUpBeforeClass();
		self::$event_uid = self::EVENT_UID.'-'.gmdate('YmdHis').'-'.bin2hex(random_bytes(2));
	}

	public static function tearDownAfterClass() : void
	{
		self::cleanupEvent();
		parent::tearDownAfterClass();
	}

	protected function eventUrl() : string
	{
		return '/'.$this->user().'/calendar/'.$this->eventUid().'.ics';
	}

	protected function user() : string
	{
		return $GLOBALS['EGW_USER'];
	}

	protected function eventUid() : string
	{
		return self::$event_uid;
	}

	protected static function cleanupEvent() : void
	{
		if(empty($GLOBALS['egw']) || empty($GLOBALS['egw']->db))
		{
			return;
		}

		$so = new \calendar_so();
		foreach(array_unique(self::$cal_ids) as $cal_id)
		{
			if((int)$cal_id > 0)
			{
				$so->delete((int)$cal_id);
			}
		}

		$events = $so->read(self::$event_uid) ?: [];
		foreach(array_keys($events) as $cal_id)
		{
			$so->delete((int)$cal_id);
		}

		$remaining = $so->read(self::$event_uid) ?: [];
		if($remaining)
		{
			error_log(__CLASS__.' manual cleanup required for cal_id(s): '.implode(',', array_keys($remaining)));
		}
		self::$cal_ids = [];
	}

	protected function addCalendarID($response) : void
	{
		$array = explode(':', trim(($response->getHeader('ETag')[0] ?? ''), '[]"'));
		if(!empty($array[0]))
		{
			self::$cal_ids[] = (int)$array[0];
		}
	}

	protected function eventIcal() : string
	{
		return "BEGIN:VCALENDAR\r\n".
			"VERSION:2.0\r\n".
			"BEGIN:VTIMEZONE\r\n".
			"TZID:Europe/Berlin\r\n".
			"BEGIN:DAYLIGHT\r\n".
			"TZOFFSETFROM:+0100\r\n".
			"TZOFFSETTO:+0200\r\n".
			"TZNAME:CEST\r\n".
			"DTSTART:19700329T020000\r\n".
			"RRULE:FREQ=YEARLY;BYMONTH=3;BYDAY=-1SU\r\n".
			"END:DAYLIGHT\r\n".
			"BEGIN:STANDARD\r\n".
			"TZOFFSETFROM:+0200\r\n".
			"TZOFFSETTO:+0100\r\n".
			"TZNAME:CET\r\n".
			"DTSTART:19701025T030000\r\n".
			"RRULE:FREQ=YEARLY;BYMONTH=10;BYDAY=-1SU\r\n".
			"END:STANDARD\r\n".
			"END:VTIMEZONE\r\n".
			"BEGIN:VEVENT\r\n".
			"DTSTART;TZID=Europe/Berlin:20300101T200000\r\n".
			"DTEND;TZID=Europe/Berlin:20300101T210000\r\n".
			"DTSTAMP:20260508T183747Z\r\n".
			"LAST-MODIFIED:20260508T183747Z\r\n".
			"LOCATION:Somewhere\r\n".
			"SUMMARY:Tonight\r\n".
			"UID:".$this->eventUid()."\r\n".
			"END:VEVENT\r\n".
			"END:VCALENDAR\r\n";
	}

	/**
	 * Test accessing CalDAV without authentication
	 */
	public function testNoAuth()
	{
		$response = $this->getClient([])->get($this->url('/'));

		$this->assertHttpStatus(401, $response);
	}

	/**
	 * Test accessing CalDAV with authentication
	 */
	public function testAuth()
	{
		$response = $this->getClient()->propfind($this->url('/principals/users/'.$this->user().'/'), [
			RequestOptions::HEADERS => [
				'Depth' => 0,
			],
		]);

		$this->assertHttpStatus(207, $response);
	}

	/**
	 * Create an event
	 */
	public function testCreate()
	{
		$response = $this->getClient()->put($this->url($this->eventUrl()), [
			RequestOptions::HEADERS => [
				'Content-Type' => 'text/calendar',
				'Prefer' => 'return=representation',
			],
			RequestOptions::BODY => $this->eventIcal(),
		]);
		$this->addCalendarID($response);

		$this->assertHttpStatus([200, 201], $response);
	}

	/**
	 * Read created event
	 */
	#[Depends('testCreate')]
	public function testRead()
	{
		$response = $this->getClient()->get($this->url($this->eventUrl()));

		$this->assertHttpStatus(200, $response);
		$this->assertIcal($this->eventIcal(), $response->getBody());
	}

	/**
	 * Delete created event
	 */
	#[Depends('testCreate')]
	public function testDelete()
	{
		$response = $this->getClient()->delete($this->url($this->eventUrl()));

		$this->assertHttpStatus(204, $response);
	}

	/**
	 * Read created event
	 */
	#[Depends('testDelete')]
	public function testReadDeleted()
	{
		$response = $this->getClient()->get($this->url($this->eventUrl()));

		$this->assertHttpStatus(404, $response);
	}
}
