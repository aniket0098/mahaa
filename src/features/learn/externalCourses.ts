/** Curated external learning paths from official providers.
 *
 * This is static, documented data — no backend dependency, no invented stats.
 * Learners are always linked to the official provider page. No videos play
 * inside MahaJob unless a supported, authorized integration exists.
 *
 * Each record uses a stable unique ID and only includes verified information.
 * Pricing notes reflect what is known at the time of publishing; always
 * refer to the official provider for the most current information.
 */
export const EXTERNAL_COURSES = [
  {
    id: "harvard-cs50-intro",
    title: "CS50: Introduction to Computer Science",
    provider: "Harvard University",
    url: "https://pll.harvard.edu/course/cs50-introduction-computer-science",
    category: "Computer Science",
    difficulty: "beginner",
    summary:
      "An introduction to the intellectual enterprises of computer science and the art of programming for majors and non-majors alike. Topics include abstraction, algorithms, encapsulation, data structures, debugging, recursion, software engineering, and web development.",
    skills: ["Algorithms", "Abstraction", "Data Structures", "Programming", "Web Development", "Debugging"],
    is_free: true,
    price_note: "Free to audit",
    duration_weeks: 12,
    image_credit: "Harvard University",
  },
  {
    id: "harvard-cs50-web",
    title: "CS50's Web Programming with Python and JavaScript",
    provider: "Harvard University",
    url: "https://cs50.harvard.edu/web/",
    category: "Web Development",
    difficulty: "intermediate",
    summary:
      "An introduction to the design and implementation of web applications using Python, JavaScript, and SQL using frameworks such as Django, Flask, and Bootstrap. Topics include database design, scalability, security, and user experience.",
    skills: ["Python", "JavaScript", "SQL", "Web Development", "Django", "Flask", "API Design"],
    is_free: true,
    price_note: "Free to audit",
    duration_weeks: 12,
    image_credit: "Harvard University",
  },
  {
    id: "freecodecamp-responsive",
    title: "Responsive Web Design",
    provider: "freeCodeCamp",
    url: "https://www.freecodecamp.org/learn/responsive-web-design/",
    category: "Web Development",
    difficulty: "beginner",
    summary:
      "Learn Responsive Web Design - HTML5, CSS3, and modern layout techniques including Flexbox, CSS Grid, and Responsive Design Workflow. Build responsive websites that work on all devices.",
    skills: ["HTML5", "CSS3", "Flexbox", "CSS Grid", "Responsive Design"],
    is_free: true,
    price_note: "Free",
    duration_weeks: 30,
    image_credit: "freeCodeCamp",
  },
  {
    id: "theodinproject-fullstack",
    title: "Full-Stack Web Development",
    provider: "The Odin Project",
    url: "https://www.theodinproject.com/",
    category: "Web Development",
    difficulty: "intermediate",
    summary:
      "A complete open-source curriculum for learning full-stack web development. Covers HTML, CSS, JavaScript, Node.js, React, and Ruby on Rails. Includes real-world projects and portfolio-building opportunities.",
    skills: ["HTML", "CSS", "JavaScript", "React", "Node.js", "Ruby on Rails", "SQL"],
    is_free: true,
    price_note: "Free and open source",
    duration_weeks: 40,
    image_credit: "The Odin Project",
  },
];

/** Type for an external course record. */
export type ExternalCourse = typeof EXTERNAL_COURSES[0];